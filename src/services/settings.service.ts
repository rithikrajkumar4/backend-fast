import type { FastifyInstance } from "fastify";
import { AppSetting } from "../database/entities/app-setting.entity.js";
import {
  authSettingsSchema,
  validateAuthSettings,
  SECRET_PATHS,
  type AuthSettings,
} from "../schemas/settings.schema.js";
import { encryptSecret, decryptSecret } from "../utils/crypto.js";
import { normalizeIdentifier } from "../utils/identifiers.js";
import { AppError } from "../utils/errors.js";
import { env } from "../config/env.js";

const AUTH_KEY = "auth";

// Short TTL so every instance picks up admin changes quickly without a DB read per request
const CACHE_TTL_MS = 15_000;
let cache: { value: AuthSettings; loadedAt: number; undecryptable: string[] } | null = null;

type Json = Record<string, any>;

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

/** Admin view of the settings: secrets are blanked and reported only as set / not set. */
export interface AdminAuthSettingsView {
  settings: AuthSettings;
  secrets: Record<string, boolean>;
  warnings: string[];
  updatedAt: Date | null;
}

export class SettingsService {
  public static invalidateCache(): void {
    cache = null;
  }

  /** Current auth settings with secrets decrypted. Cached for a few seconds. */
  public static async getAuthSettings(fastify: FastifyInstance): Promise<AuthSettings> {
    if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
      return cache.value;
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

    const parsed = authSettingsSchema.safeParse(stored);
    if (!parsed.success) {
      fastify.log.error({ issues: parsed.error.issues }, "Stored auth settings are invalid, using defaults");
    }
    const value = parsed.success ? parsed.data : authSettingsSchema.parse({});
    cache = { value, loadedAt: Date.now(), undecryptable };
    return value;
  }

  public static async getAdminView(fastify: FastifyInstance): Promise<AdminAuthSettingsView> {
    const settings = structuredClone(await this.getAuthSettings(fastify));
    const secrets: Record<string, boolean> = {};
    for (const path of SECRET_PATHS) {
      secrets[path] = !!getPath(settings, path);
      setPath(settings, path, "");
    }
    const row = await fastify.db.getRepository(AppSetting).findOne({
      where: { key: AUTH_KEY },
      select: { key: true, updatedAt: true },
    });
    const warnings = this.getWarnings(settings);
    for (const path of cache?.undecryptable ?? []) {
      warnings.unshift(
        `The saved secret "${path}" can't be decrypted, probably because CONFIG_ENCRYPTION_KEY or JWT_SECRET changed. Enter it again.`
      );
    }
    return { settings, secrets, warnings, updatedAt: row?.updatedAt ?? null };
  }

  /**
   * Replaces the auth settings. For secret fields, an empty string or a missing value keeps the
   * stored secret and `null` clears it, so the admin panel never needs to read secrets back.
   */
  public static async updateAuthSettings(
    input: Json,
    adminId: string | null,
    fastify: FastifyInstance
  ): Promise<AdminAuthSettingsView> {
    this.invalidateCache();
    const current = await this.getAuthSettings(fastify);
    const next: Json = structuredClone(input ?? {});
    for (const path of SECRET_PATHS) {
      const value = getPath(next, path);
      if (value === undefined || value === "") setPath(next, path, getPath(current, path));
      else if (value === null) setPath(next, path, "");
    }

    const settings = authSettingsSchema.parse(next);
    settings.testAccounts = settings.testAccounts.map((t) => ({
      ...t,
      identifier: normalizeIdentifier(t.identifier, settings.phone.defaultCountryCode),
    }));

    const errors = validateAuthSettings(settings);
    if (errors.length > 0) {
      throw AppError.badRequest(errors[0], errors.map((message) => ({ message })));
    }

    const stored: Json = structuredClone(settings);
    for (const path of SECRET_PATHS) {
      setPath(stored, path, encryptSecret(String(getPath(stored, path) ?? "")));
    }
    await fastify.db
      .getRepository(AppSetting)
      .save({ key: AUTH_KEY, value: stored, updatedBy: adminId });

    this.invalidateCache();
    return this.getAdminView(fastify);
  }

  /** Non-blocking issues the admin should know about. */
  public static getWarnings(s: AuthSettings): string[] {
    const warnings: string[] = [];
    const isProd = env.NODE_ENV === "production";
    const consoleNote = isProd
      ? "codes are only written to the server log, so real users can't sign in"
      : "codes are only written to the server log (fine for development)";

    if (s.email.enabled && s.delivery.email.provider === "console") {
      warnings.push(`Email login uses the console provider: ${consoleNote}.`);
    }
    if (s.phone.enabled && s.phone.sms && s.delivery.sms.provider === "console") {
      warnings.push(`SMS uses the console provider: ${consoleNote}.`);
    }
    if (s.phone.enabled && s.phone.whatsapp && s.delivery.whatsapp.provider === "console") {
      warnings.push(`WhatsApp uses the console provider: ${consoleNote}.`);
    }
    if (s.phone.enabled && s.phone.whatsapp && s.delivery.whatsapp.provider === "twilio" && !s.delivery.twilio.whatsappContentSid) {
      warnings.push(
        "WhatsApp via Twilio has no Content SID: free-form messages only work in the Twilio sandbox. Add an approved template for production."
      );
    }
    if (!isProd) {
      warnings.push(`Not running in production: every OTP is the fixed development code (DEFAULT_OTP) unless a test account overrides it.`);
    }
    if (isProd && !env.CONFIG_ENCRYPTION_KEY) {
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
