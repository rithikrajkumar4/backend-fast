import { env } from "../config/env.js";
import type { AuthSettings } from "../schemas/settings.schema.js";
import type { LoadedAuthSettings } from "./settings.service.js";
import { verifySmtpConnection } from "./delivery.service.js";

export type StatusLevel = "ok" | "warning" | "error" | "off";
export type StatusKey = "email" | "sms" | "whatsapp" | "google" | "apple" | "facebook";

export interface StatusProblem {
  level: "warning" | "error";
  message: string;
}

/** Whether one login method actually works, and if not, why. */
export interface MethodStatus {
  key: StatusKey;
  label: string;
  level: StatusLevel;
  /** One line: what's working, or the most important problem */
  summary: string;
  problems: StatusProblem[];
  /** True when the provider was contacted to check credentials */
  checkedLive: boolean;
}

export interface StatusOptions {
  /** Contact providers (SMTP, Twilio, Meta, Facebook, Google/Apple key servers) to verify credentials */
  live?: boolean;
  fetch?: typeof fetch;
  verifySmtp?: (smtp: AuthSettings["delivery"]["email"]["smtp"]) => Promise<void>;
}

const TIMEOUT_MS = 8_000;

const FIELD_LABELS: Record<string, string> = {
  "email.enabled": "Email login on/off",
  "phone.enabled": "Phone login on/off",
  "phone.sms": "SMS on/off",
  "phone.whatsapp": "WhatsApp on/off",
  "delivery.email.provider": "Email provider",
  "delivery.email.from": "Email From address",
  "delivery.email.smtp.host": "SMTP host",
  "delivery.email.smtp.port": "SMTP port",
  "delivery.email.smtp.user": "SMTP username",
  "delivery.email.smtp.password": "SMTP password",
  "delivery.sms.provider": "SMS provider",
  "delivery.whatsapp.provider": "WhatsApp provider",
  "delivery.twilio.accountSid": "Twilio Account SID",
  "delivery.twilio.authToken": "Twilio Auth Token",
  "delivery.twilio.smsFrom": "Twilio SMS sender",
  "delivery.twilio.whatsappFrom": "Twilio WhatsApp sender",
  "delivery.twilio.whatsappContentSid": "Twilio WhatsApp Content SID",
  "delivery.meta.phoneNumberId": "WhatsApp phone number ID",
  "delivery.meta.accessToken": "WhatsApp access token",
  "delivery.meta.templateName": "WhatsApp template name",
  "sso.google.enabled": "Google on/off",
  "sso.google.clientIds": "Google client IDs",
  "sso.apple.enabled": "Apple on/off",
  "sso.apple.clientIds": "Apple bundle / Services IDs",
  "sso.facebook.enabled": "Facebook on/off",
  "sso.facebook.appId": "Facebook App ID",
  "sso.facebook.appSecret": "Facebook App Secret",
};

const label = (path: string) => FIELD_LABELS[path] ?? path;

class Checker {
  readonly problems: StatusProblem[] = [];
  error(message: string) {
    this.problems.push({ level: "error", message });
  }
  warn(message: string) {
    this.problems.push({ level: "warning", message });
  }
  get ok() {
    return !this.problems.some((p) => p.level === "error");
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "timed out";
    return err.message;
  }
  return String(err);
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    return json?.message || json?.error?.message || json?.error_description || text || res.statusText;
  } catch {
    return text || res.statusText;
  }
}

export class AuthStatusService {
  public static async check(loaded: LoadedAuthSettings, options: StatusOptions = {}): Promise<MethodStatus[]> {
    const s = loaded.settings;
    const ctx = { loaded, live: !!options.live, fetch: options.fetch ?? fetch, verifySmtp: options.verifySmtp ?? verifySmtpConnection };

    return Promise.all([
      this.run("email", "Email", s.email.enabled, ctx, ["email.", "delivery.email."], (c) => this.checkEmail(c, ctx)),
      this.run("sms", "SMS", s.phone.enabled && s.phone.sms, ctx, ["phone.", "delivery.sms.", ...(s.delivery.sms.provider === "twilio" ? ["delivery.twilio."] : [])], (c) =>
        this.checkSms(c, ctx)
      ),
      this.run(
        "whatsapp",
        "WhatsApp",
        s.phone.enabled && s.phone.whatsapp,
        ctx,
        ["phone.", "delivery.whatsapp.", ...(s.delivery.whatsapp.provider === "twilio" ? ["delivery.twilio."] : []), ...(s.delivery.whatsapp.provider === "meta" ? ["delivery.meta."] : [])],
        (c) => this.checkWhatsapp(c, ctx)
      ),
      this.run("google", "Google", s.sso.google.enabled, ctx, ["sso.google."], (c) => this.checkJwtProvider(c, ctx, "google")),
      this.run("apple", "Apple", s.sso.apple.enabled, ctx, ["sso.apple."], (c) => this.checkJwtProvider(c, ctx, "apple")),
      this.run("facebook", "Facebook", s.sso.facebook.enabled, ctx, ["sso.facebook."], (c) => this.checkFacebook(c, ctx)),
    ]);
  }

  private static async run(
    key: StatusKey,
    name: string,
    enabled: boolean,
    ctx: { loaded: LoadedAuthSettings; live: boolean },
    envPrefixes: string[],
    body: (c: Checker) => Promise<string | void>
  ): Promise<MethodStatus> {
    const c = new Checker();

    // Env problems first: an on/off switch read from a missing variable explains why a method is off
    for (const [path, state] of Object.entries(ctx.loaded.envState)) {
      if (!envPrefixes.some((p) => path.startsWith(p))) continue;
      if (!state.isSet) {
        c.error(`${label(path)} reads from env variable ${state.name}, which isn't set on the server. Set it and restart, or switch the field back to a saved value.`);
      } else if (state.invalid) {
        c.error(`Env variable ${state.name} (${label(path)}) has an invalid value: ${state.invalid}. The saved value is used instead.`);
      }
    }

    if (!enabled) {
      return { key, label: name, level: c.problems.length ? "warning" : "off", summary: "Turned off, so the app doesn't show it.", problems: c.problems, checkedLive: false };
    }

    for (const path of ctx.loaded.undecryptable) {
      if (envPrefixes.some((p) => path.startsWith(p))) {
        c.error(`The saved ${label(path)} can't be decrypted (CONFIG_ENCRYPTION_KEY or JWT_SECRET changed). Enter it again.`);
      }
    }

    let okSummary: string | void = undefined;
    try {
      okSummary = await body(c);
    } catch (err) {
      c.error(`Check failed: ${describe(err)}`);
    }

    const errors = c.problems.filter((p) => p.level === "error");
    const level: StatusLevel = errors.length ? "error" : c.problems.length ? "warning" : "ok";
    const summary =
      errors[0]?.message ??
      (level === "warning" ? `Works, with a warning: ${c.problems[0].message}` : okSummary || "Working.");
    return { key, label: name, level, summary, problems: c.problems, checkedLive: ctx.live };
  }

  private static consoleProvider(c: Checker, channel: string) {
    if (env.NODE_ENV === "production") {
      c.error(`${channel} uses the Console provider: codes are only written to the server log, so users never receive them. Choose a real provider.`);
    } else {
      c.warn(`${channel} uses the Console provider: codes are only written to the server log (fine for development).`);
    }
  }

  private static async checkEmail(c: Checker, ctx: CheckContext): Promise<string | void> {
    const email = ctx.loaded.settings.delivery.email;
    if (email.provider === "console") return this.consoleProvider(c, "Email");

    if (!email.smtp.host) c.error("SMTP host is missing.");
    if (!email.from) c.error("Email From address is missing.");
    if (email.smtp.user && !email.smtp.password) c.warn("SMTP username is set but the password is empty.");
    if (!c.ok) return;

    if (ctx.live) {
      try {
        await withTimeout(ctx.verifySmtp(email.smtp));
      } catch (err) {
        c.error(`Couldn't log in to SMTP server ${email.smtp.host}:${email.smtp.port}: ${describe(err)}`);
        return;
      }
      return `Connected to ${email.smtp.host} and logged in. Codes are sent from ${email.from}.`;
    }
    return `Sends with SMTP via ${email.smtp.host}. Run the live check to test the login.`;
  }

  private static async checkSms(c: Checker, ctx: CheckContext): Promise<string | void> {
    const s = ctx.loaded.settings;
    if (s.delivery.sms.provider === "console") return this.consoleProvider(c, "SMS");

    const t = s.delivery.twilio;
    if (!t.accountSid) c.error("Twilio Account SID is missing.");
    else if (!/^AC[0-9a-fA-F]{32}$/.test(t.accountSid)) c.warn("Twilio Account SID doesn't look right (it should be AC followed by 32 hex characters).");
    if (!t.authToken) c.error("Twilio Auth Token is missing.");
    if (!t.smsFrom) c.error("Twilio SMS sender (a number or a Messaging Service SID) is missing.");
    if (!c.ok) return;

    if (ctx.live && !(await this.checkTwilioAccount(c, ctx))) return;
    return ctx.live ? `Twilio account is active. Sending from ${t.smsFrom}.` : `Sends with Twilio from ${t.smsFrom}. Run the live check to test the credentials.`;
  }

  private static async checkWhatsapp(c: Checker, ctx: CheckContext): Promise<string | void> {
    const s = ctx.loaded.settings;
    const provider = s.delivery.whatsapp.provider;
    if (provider === "console") return this.consoleProvider(c, "WhatsApp");

    if (provider === "twilio") {
      const t = s.delivery.twilio;
      if (!t.accountSid) c.error("Twilio Account SID is missing.");
      if (!t.authToken) c.error("Twilio Auth Token is missing.");
      if (!t.whatsappFrom) c.error("Twilio WhatsApp sender number is missing.");
      if (!t.whatsappContentSid) {
        c.warn("No Content SID: Twilio only delivers free-form WhatsApp messages in its sandbox. Add an approved template for real users.");
      }
      if (!c.ok) return;
      if (ctx.live && !(await this.checkTwilioAccount(c, ctx))) return;
      return ctx.live ? `Twilio account is active. Sending from ${t.whatsappFrom}.` : `Sends with Twilio from ${t.whatsappFrom}. Run the live check to test the credentials.`;
    }

    const m = s.delivery.meta;
    if (!m.phoneNumberId) c.error("WhatsApp phone number ID is missing.");
    if (!m.accessToken) c.error("WhatsApp access token is missing.");
    if (!m.templateName) c.error("WhatsApp authentication template name is missing.");
    if (!c.ok) return;

    if (ctx.live) {
      try {
        const url = `https://graph.facebook.com/${m.graphApiVersion}/${encodeURIComponent(m.phoneNumberId)}?fields=display_phone_number,verified_name`;
        const res = await ctx.fetch(url, {
          headers: { Authorization: `Bearer ${m.accessToken}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          c.error(`Meta rejected the phone number ID or access token: ${await readError(res)}`);
          return;
        }
        const info = (await res.json()) as { display_phone_number?: string; verified_name?: string };
        return `Connected to WhatsApp number ${info.display_phone_number ?? m.phoneNumberId}${info.verified_name ? ` (${info.verified_name})` : ""}. Template "${m.templateName}" isn't checked; make sure it's approved.`;
      } catch (err) {
        c.error(`Couldn't reach the WhatsApp Cloud API: ${describe(err)}`);
        return;
      }
    }
    return `Sends with the WhatsApp Cloud API using template "${m.templateName}". Run the live check to test the token.`;
  }

  /** Returns false (with an error recorded) when Twilio rejects the credentials. */
  private static async checkTwilioAccount(c: Checker, ctx: CheckContext): Promise<boolean> {
    const t = ctx.loaded.settings.delivery.twilio;
    try {
      const res = await ctx.fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}.json`, {
        headers: { Authorization: `Basic ${Buffer.from(`${t.accountSid}:${t.authToken}`).toString("base64")}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 404) {
        c.error("Twilio rejected the Account SID / Auth Token.");
        return false;
      }
      if (!res.ok) {
        c.error(`Twilio returned an error: ${await readError(res)}`);
        return false;
      }
      const account = (await res.json()) as { status?: string };
      if (account.status && account.status !== "active") {
        c.error(`The Twilio account is ${account.status}.`);
        return false;
      }
      return true;
    } catch (err) {
      c.error(`Couldn't reach Twilio: ${describe(err)}`);
      return false;
    }
  }

  private static async checkJwtProvider(c: Checker, ctx: CheckContext, provider: "google" | "apple"): Promise<string | void> {
    const ids = ctx.loaded.settings.sso[provider].clientIds;
    const name = provider === "google" ? "Google" : "Apple";
    if (ids.length === 0) {
      c.error(provider === "google" ? "No Google OAuth client IDs: every Google sign-in will be rejected." : "No bundle ID or Services ID: every Apple sign-in will be rejected.");
      return;
    }
    for (const id of ids) {
      if (provider === "google" && !id.endsWith(".apps.googleusercontent.com")) {
        c.warn(`"${id}" doesn't look like a Google OAuth client ID (they end in .apps.googleusercontent.com).`);
      }
      if (provider === "apple" && !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(id)) {
        c.warn(`"${id}" doesn't look like a bundle ID or Services ID (e.g. com.example.app).`);
      }
    }

    if (ctx.live) {
      const keysUrl = provider === "google" ? "https://www.googleapis.com/oauth2/v3/certs" : "https://appleid.apple.com/auth/keys";
      try {
        const res = await ctx.fetch(keysUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        c.error(`The server can't download ${name}'s signing keys, so sign-ins can't be verified: ${describe(err)}`);
        return;
      }
    }
    return `Accepts ${name} tokens for ${ids.length} ${ids.length === 1 ? "ID" : "IDs"}. ${name} doesn't let servers check client IDs, so test a real sign-in from the app.`;
  }

  private static async checkFacebook(c: Checker, ctx: CheckContext): Promise<string | void> {
    const { appId, appSecret } = ctx.loaded.settings.sso.facebook;
    if (!appId) c.error("Facebook App ID is missing.");
    else if (!/^[0-9]+$/.test(appId)) c.warn("Facebook App ID should be numeric.");
    if (!appSecret) c.error("Facebook App Secret is missing.");
    if (!c.ok) return;

    if (ctx.live) {
      try {
        const url = new URL("https://graph.facebook.com/oauth/access_token");
        url.searchParams.set("client_id", appId);
        url.searchParams.set("client_secret", appSecret);
        url.searchParams.set("grant_type", "client_credentials");
        const res = await ctx.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) {
          c.error(`Facebook rejected the App ID / App Secret: ${await readError(res)}`);
          return;
        }
        return `Facebook accepted the App ID and App Secret.`;
      } catch (err) {
        c.error(`Couldn't reach Facebook: ${describe(err)}`);
        return;
      }
    }
    return "App ID and secret are set. Run the live check to confirm Facebook accepts them.";
  }
}

type CheckContext = {
  loaded: LoadedAuthSettings;
  live: boolean;
  fetch: typeof fetch;
  verifySmtp: (smtp: AuthSettings["delivery"]["email"]["smtp"]) => Promise<void>;
};

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })), TIMEOUT_MS)),
  ]);
}
