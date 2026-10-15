import type { FastifyInstance } from "fastify";
import { AppSetting } from "../database/entities/app-setting.entity.js";
import {
  authSettingsSchema,
  validateAuthSettings,
  envRefsSchema,
  suggestEnvName,
  ENV_PATHS,
  AUTH_SETTINGS_DEFAULTS,
  SECRET_PATHS,
  type AuthSettings,
  type EnvRefs,
} from "../schemas/settings.schema.js";
import { encryptSecret, decryptSecret } from "../utils/crypto.js";
import { normalizeIdentifier } from "../utils/identifiers.js";
import { AppError } from "../utils/errors.js";
import { env } from "../config/env.js";

const AUTH_KEY = "auth";

// Short TTL so every instance picks up admin changes (and env changes) quickly without a DB read per request
const CACHE_TTL_MS = 15_000;

type Json = Record<string, any>;

/** How one env-sourced setting resolved. */
export interface EnvSourceState {
  name: string;
  /** The variable exists on the server */
  isSet: boolean;
  /** Set, but not a valid value for this setting (the saved value is used instead) */
  invalid?: string;
}

export interface LoadedAuthSettings {
  /** Effective settings: saved values with env variables applied. What the app and providers use. */
  settings: AuthSettings;
  /** Values saved in the panel (decrypted), before env variables */
  saved: AuthSettings;
  envRefs: EnvRefs;
  envState: Record<string, EnvSourceState>;
  /** Saved secrets that couldn't be decrypted (encryption key changed) */
  undecryptable: string[];
  updatedAt: Date | null;
}

let cache: { loaded: LoadedAuthSettings; loadedAt: number } | null = null;

function getPath(obj: Json, path: string): unknown {
  return path.split(".").reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function setPath(obj: Json, path: string, value: unknown): void {
  const keys = path.split(".");
  let cur = obj;
  for (const key of keys.slice(0, -1)) {
    if (cur[key] == null || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key];
  }
  cur[keys[keys.length - 1]] = value;
}

/** Converts an env string to the type of the setting at `path`, or returns an error message. */
function coerceEnvValue(path: string, raw: string): { value: unknown } | { error: string } {
  const sample = getPath(AUTH_SETTINGS_DEFAULTS, path);
  if (typeof sample === "boolean") {
    if (/^(true|1|yes|on)$/i.test(raw.trim())) return { value: true };
    if (/^(false|0|no|off)$/i.test(raw.trim())) return { value: false };
    return { error: "must be true or false" };
  }
  if (typeof sample === "number") {
    const n = Number(raw.trim());
    return Number.isFinite(n) && raw.trim() !== "" ? { value: n } : { error: "must be a number" };
  }
  if (Array.isArray(sample)) {
    return { value: raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) };
  }
  return { value: raw };
}

/** Admin view: secrets blanked, plus env sources and their state. */
export interface AdminAuthSettingsView {
  /** Values saved in the panel (secrets blank). Env-sourced fields keep their saved fallback. */
  settings: AuthSettings;
  secrets: Record<string, boolean>;
  envRefs: EnvRefs;
  envState: Record<string, EnvSourceState>;
  /** Every setting that can come from env, with a suggested variable name */
  envSuggestions: Record<string, string>;
  warnings: string[];
  updatedAt: Date | null;
}

export class SettingsService {
  public static invalidateCache(): void {
    cache = null;
  }

  /** Effective auth settings (saved values with env variables applied). Cached for a few seconds. */
  public static async getAuthSettings(fastify: FastifyInstance): Promise<AuthSettings> {
    return (await this.load(fastify)).settings;
  }

  public static async load(fastify: FastifyInstance): Promise<LoadedAuthSettings> {
    if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
      return cache.loaded;
    }

    const row = await fastify.db.getRepository(AppSetting).findOneBy({ key: AUTH_KEY });
    const stored: Json = structuredClone(row?.value ?? {});

    const undecryptable: string[] = [];
    for (const path of SECRET_PATHS) {
      const value = getPath(stored, path);
      if (typeof value !== "string") continue;
      const plain = decryptSecret(value);
      if (value && !plain) undecryptable.push(path);
      setPath(stored, path, plain);
    }
    if (undecryptable.length > 0) {
      fastify.log.warn(
        { paths: undecryptable },
        "Couldn't decrypt saved auth secrets (CONFIG_ENCRYPTION_KEY or JWT_SECRET changed?). Re-enter them in the admin panel."
      );
    }

    const parsedSaved = authSettingsSchema.safeParse(stored);
    if (!parsedSaved.success) {
      fastify.log.error({ issues: parsedSaved.error.issues }, "Stored auth settings are invalid, using defaults");
    }
    const saved = parsedSaved.success ? parsedSaved.data : authSettingsSchema.parse({});

    const parsedRefs = envRefsSchema.safeParse(stored.envRefs ?? {});
    const envRefs: EnvRefs = parsedRefs.success ? parsedRefs.data : {};
    const { settings, envState } = this.applyEnv(saved, envRefs);

    const loaded: LoadedAuthSettings = {
      settings,
      saved,
      envRefs,
      envState,
      undecryptable,
      updatedAt: row?.updatedAt ?? null,
    };
    cache = { loaded, loadedAt: Date.now() };
    return loaded;
  }

  /**
   * Overlays env variables on the saved settings. A missing variable keeps the saved value; a value
   * the setting doesn't accept (e.g. OTP length 20) is reported and the saved value is kept.
   */
  private static applyEnv(saved: AuthSettings, envRefs: EnvRefs) {
    const envState: Record<string, EnvSourceState> = {};
    const merged: Json = structuredClone(saved);

    for (const [path, name] of Object.entries(envRefs)) {
      const raw = process.env[name];
      envState[path] = { name, isSet: raw !== undefined && raw !== "" };
      if (!envState[path].isSet) continue;
      const coerced = coerceEnvValue(path, raw!);
      if ("error" in coerced) envState[path].invalid = coerced.error;
      else setPath(merged, path, coerced.value);
    }

    let parsed = authSettingsSchema.safeParse(merged);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = Object.keys(envRefs).find((p) => issue.path.join(".").startsWith(p));
        if (path) {
          envState[path].invalid = issue.message;
          setPath(merged, path, getPath(saved, path));
        }
      }
      parsed = authSettingsSchema.safeParse(merged);
    }
    return { settings: parsed.success ? parsed.data : saved, envState };
  }

  public static async getAdminView(fastify: FastifyInstance): Promise<AdminAuthSettingsView> {
    const loaded = await this.load(fastify);
    const settings = structuredClone(loaded.saved);
    const secrets: Record<string, boolean> = {};
    for (const path of SECRET_PATHS) {
      secrets[path] = !!getPath(settings, path);
      setPath(settings, path, "");
    }
    return {
      settings,
      secrets,
      envRefs: loaded.envRefs,
      envState: loaded.envState,
      envSuggestions: Object.fromEntries(ENV_PATHS.map((p) => [p, suggestEnvName(p)])),
      warnings: this.getWarnings(loaded),
      updatedAt: loaded.updatedAt,
    };
  }

  /**
   * Replaces the auth settings. For secret fields, an empty string or a missing value keeps the
   * saved secret and `null` clears it, so the admin panel never needs to read secrets back.
   * `envRefs` maps setting paths to the env variables they should be read from.
   */
  public static async updateAuthSettings(
    input: Json,
    adminId: string | null,
    fastify: FastifyInstance
  ): Promise<AdminAuthSettingsView> {
    this.invalidateCache();
    const current = await this.load(fastify);
    const next: Json = structuredClone(input ?? {});
    const envRefs = envRefsSchema.parse(next.envRefs ?? {});
    delete next.envRefs;

    for (const path of SECRET_PATHS) {
      const value = getPath(next, path);
      // Keep the *saved* secret, never one that came from an env variable
      if (value === undefined || value === "") setPath(next, path, getPath(current.saved, path));
      else if (value === null) setPath(next, path, "");
    }

    const settings = authSettingsSchema.parse(next);
    settings.testAccounts = settings.testAccounts.map((t) => ({
      ...t,
      identifier: normalizeIdentifier(t.identifier, settings.phone.defaultCountryCode),
    }));

    // Check what the server will actually run with: env values applied, and a field that reads
    // from an env variable counts as filled in even if the variable isn't set yet (status reports that)
    const effective = structuredClone(this.applyEnv(settings, envRefs).settings);
    for (const path of Object.keys(envRefs)) {
      const value = getPath(effective, path);
      if (value === "") setPath(effective, path, "(from env)");
      else if (Array.isArray(value) && value.length === 0) setPath(effective, path, ["(from env)"]);
    }
    const errors = validateAuthSettings(effective);
    if (errors.length > 0) {
      throw AppError.badRequest(errors[0], errors.map((message) => ({ message })));
    }

    const stored: Json = structuredClone(settings);
    for (const path of SECRET_PATHS) {
      setPath(stored, path, encryptSecret(String(getPath(stored, path) ?? "")));
    }
    stored.envRefs = envRefs;
    await fastify.db
      .getRepository(AppSetting)
      .save({ key: AUTH_KEY, value: stored, updatedBy: adminId });

    this.invalidateCache();
    return this.getAdminView(fastify);
  }

  /** Server-level issues the admin should know about (per-method problems are in AuthStatusService). */
  public static getWarnings(loaded: LoadedAuthSettings): string[] {
    const warnings: string[] = [];
    for (const path of loaded.undecryptable) {
      warnings.push(
        `The saved secret "${path}" can't be decrypted, probably because CONFIG_ENCRYPTION_KEY or JWT_SECRET changed. Enter it again.`
      );
    }
    if (env.NODE_ENV !== "production") {
      warnings.push(
        "Not running in production: every OTP is the fixed development code (DEFAULT_OTP) unless a test account overrides it."
      );
    }
    if (env.NODE_ENV === "production" && !env.CONFIG_ENCRYPTION_KEY) {
      warnings.push("CONFIG_ENCRYPTION_KEY is not set: provider secrets are encrypted with a key derived from JWT_SECRET.");
    }
    return warnings;
  }

  /** What the mobile/web app needs to render its login screen. Contains no secrets. */
  public static toPublicConfig(s: AuthSettings) {
    const channels = (["sms", "whatsapp"] as const).filter((c) => s.phone[c]);
    return {
      appName: s.appName,
      email: { enabled: s.email.enabled },
      phone: {
        enabled: s.phone.enabled && channels.length > 0,
        channels,
        defaultChannel: s.phone.defaultChannel,
        defaultCountryCode: s.phone.defaultCountryCode || null,
      },
      otp: {
        length: s.otp.length,
        ttlSeconds: s.otp.ttlSeconds,
        resendCooldownSeconds: s.otp.resendCooldownSeconds,
      },
      sso: {
        google: { enabled: s.sso.google.enabled, clientIds: s.sso.google.enabled ? s.sso.google.clientIds : [] },
        apple: { enabled: s.sso.apple.enabled, clientIds: s.sso.apple.enabled ? s.sso.apple.clientIds : [] },
        facebook: { enabled: s.sso.facebook.enabled, appId: s.sso.facebook.enabled ? s.sso.facebook.appId : null },
      },
    };
  }
}
