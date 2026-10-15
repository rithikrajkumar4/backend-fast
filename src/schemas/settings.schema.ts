import { z } from "zod";

/**
 * Auth configuration edited from the admin panel and stored in `app_settings` under the "auth" key.
 * Every field has a default, so a partially stored document (or a new field added later) always
 * parses into a complete config.
 */

const trimmed = (max = 255) => z.string().trim().max(max).default("");
const clientIdList = z.array(z.string().trim().min(1).max(255)).max(10).default([]);

export const authSettingsSchema = z.object({
  // Used in OTP messages: "Your <appName> verification code is 123456"
  appName: z.string().trim().min(1, "App name is required").max(60).default("App"),

  email: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default({}),

  phone: z
    .object({
      enabled: z.boolean().default(true),
      sms: z.boolean().default(true),
      whatsapp: z.boolean().default(false),
      defaultChannel: z.enum(["sms", "whatsapp"]).default("sms"),
      // Prepended to numbers entered without a leading "+", e.g. "+91"
      defaultCountryCode: z
        .string()
        .trim()
        .regex(/^(\+[0-9]{1,4})?$/, "Default country code must look like +91")
        .default(""),
    })
    .default({}),

  otp: z
    .object({
      length: z.number().int().min(4).max(8).default(6),
      ttlSeconds: z.number().int().min(60).max(3600).default(300),
      maxAttempts: z.number().int().min(1).max(20).default(5),
      resendCooldownSeconds: z.number().int().min(0).max(600).default(30),
      maxSendsPerHour: z.number().int().min(1).max(1000).default(5),
    })
    .default({}),

  // Fixed codes for specific phone numbers/emails (e.g. App Store / Play Store review accounts).
  // No message is sent for these identifiers.
  testAccounts: z
    .array(
      z.object({
        identifier: z.string().trim().min(3).max(255),
        code: z.string().regex(/^[0-9]{4,8}$/, "Test account codes must be 4-8 digits"),
      })
    )
    .max(50)
    .default([]),

  sso: z
    .object({
      // Sign a provider login into an existing account when both sides have the same verified email
      autoLinkByVerifiedEmail: z.boolean().default(true),
      google: z
        .object({
          enabled: z.boolean().default(false),
          clientIds: clientIdList, // web, iOS and Android OAuth client IDs
        })
        .default({}),
      apple: z
        .object({
          enabled: z.boolean().default(false),
          clientIds: clientIdList, // app bundle ID and/or Services ID
        })
        .default({}),
      facebook: z
        .object({
          enabled: z.boolean().default(false),
          appId: trimmed(64),
          appSecret: trimmed(),
        })
        .default({}),
    })
    .default({}),

  delivery: z
    .object({
      email: z
        .object({
          provider: z.enum(["console", "smtp"]).default("console"),
          from: trimmed(),
          smtp: z
            .object({
              host: trimmed(),
              port: z.number().int().min(1).max(65535).default(587),
              secure: z.boolean().default(false),
              user: trimmed(),
              password: trimmed(),
            })
            .default({}),
        })
        .default({}),
      sms: z
        .object({
          provider: z.enum(["console", "twilio"]).default("console"),
        })
        .default({}),
      whatsapp: z
        .object({
          provider: z.enum(["console", "twilio", "meta"]).default("console"),
        })
        .default({}),
      twilio: z
        .object({
          accountSid: trimmed(64),
          authToken: trimmed(),
          smsFrom: trimmed(64), // E.164 number or Messaging Service SID (MG...)
          whatsappFrom: trimmed(64), // E.164 WhatsApp sender
          whatsappContentSid: trimmed(64), // approved template (HX...) with {{1}} = code
        })
        .default({}),
      meta: z
        .object({
          phoneNumberId: trimmed(64),
          accessToken: trimmed(1024),
          templateName: trimmed(128), // approved "authentication" template
          templateLanguage: z.string().trim().max(16).default("en_US"),
          copyCodeButton: z.boolean().default(true),
          graphApiVersion: z
            .string()
            .trim()
            .regex(/^v[0-9]+\.[0-9]+$/, "Graph API version must look like v22.0")
            .default("v22.0"),
        })
        .default({}),
    })
    .default({}),
});

export type AuthSettings = z.infer<typeof authSettingsSchema>;

/** Settings fields stored encrypted and never returned by the admin API. */
export const SECRET_PATHS = [
  "sso.facebook.appSecret",
  "delivery.email.smtp.password",
  "delivery.twilio.authToken",
  "delivery.meta.accessToken",
] as const;

export type SecretPath = (typeof SECRET_PATHS)[number];

/**
 * Cross-field rules enforced when an admin saves settings. Not applied when loading, so a config
 * saved before a rule existed keeps working.
 */
export function validateAuthSettings(s: AuthSettings): string[] {
  const errors: string[] = [];
  const d = s.delivery;

  const phoneOn = s.phone.enabled && (s.phone.sms || s.phone.whatsapp);
  const ssoOn = s.sso.google.enabled || s.sso.apple.enabled || s.sso.facebook.enabled;
  if (!s.email.enabled && !phoneOn && !ssoOn) {
    errors.push("At least one login method must be enabled.");
  }

  if (s.phone.enabled) {
    if (!s.phone.sms && !s.phone.whatsapp) {
      errors.push("Phone login needs SMS or WhatsApp enabled.");
    } else if (!s.phone[s.phone.defaultChannel]) {
      errors.push(`The default phone channel (${s.phone.defaultChannel}) must be enabled.`);
    }
  }

  if (s.email.enabled && d.email.provider === "smtp") {
    if (!d.email.smtp.host) errors.push("SMTP host is required.");
    if (!d.email.from) errors.push("Email 'From' address is required.");
  }

  const twilioCreds = !!d.twilio.accountSid && !!d.twilio.authToken;
  if (s.phone.enabled && s.phone.sms && d.sms.provider === "twilio") {
    if (!twilioCreds) errors.push("Twilio Account SID and Auth Token are required for SMS.");
    if (!d.twilio.smsFrom) errors.push("Twilio SMS sender (number or Messaging Service SID) is required.");
  }
  if (s.phone.enabled && s.phone.whatsapp && d.whatsapp.provider === "twilio") {
    if (!twilioCreds) errors.push("Twilio Account SID and Auth Token are required for WhatsApp.");
    if (!d.twilio.whatsappFrom) errors.push("Twilio WhatsApp sender number is required.");
  }
  if (s.phone.enabled && s.phone.whatsapp && d.whatsapp.provider === "meta") {
    if (!d.meta.phoneNumberId) errors.push("WhatsApp Cloud API phone number ID is required.");
    if (!d.meta.accessToken) errors.push("WhatsApp Cloud API access token is required.");
    if (!d.meta.templateName) errors.push("WhatsApp authentication template name is required.");
  }

  if (s.sso.google.enabled && s.sso.google.clientIds.length === 0) {
    errors.push("Google sign-in needs at least one OAuth client ID.");
  }
  if (s.sso.apple.enabled && s.sso.apple.clientIds.length === 0) {
    errors.push("Apple sign-in needs at least one bundle ID or Services ID.");
  }
  if (s.sso.facebook.enabled && (!s.sso.facebook.appId || !s.sso.facebook.appSecret)) {
    errors.push("Facebook login needs the App ID and App Secret.");
  }

  const seen = new Set<string>();
  for (const t of s.testAccounts) {
    if (t.code.length !== s.otp.length) {
      errors.push(`Test account ${t.identifier}: code must be ${s.otp.length} digits (the OTP length).`);
    }
    const key = t.identifier.toLowerCase();
    if (seen.has(key)) errors.push(`Test account ${t.identifier} is listed twice.`);
    seen.add(key);
  }

  return errors;
}

// ======================= Environment variable sources =======================

/**
 * Any setting can come from an environment variable instead of a value saved in the panel.
 * Names must start with AUTH_ so the panel can't be used to read unrelated server secrets
 * (JWT_SECRET, DATABASE_URL...) into a field that's shown to the app.
 */
export const ENV_NAME_PATTERN = /^AUTH_[A-Z0-9_]{1,100}$/;

export const AUTH_SETTINGS_DEFAULTS: AuthSettings = authSettingsSchema.parse({});

function leafPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return leafPaths(value as Record<string, unknown>, path);
    }
    return [path];
  });
}

/** Every setting that can be sourced from an env variable (everything except test accounts). */
export const ENV_PATHS: string[] = leafPaths(AUTH_SETTINGS_DEFAULTS).filter((p) => p !== "testAccounts");

/** e.g. "delivery.twilio.authToken" -> "AUTH_DELIVERY_TWILIO_AUTH_TOKEN" */
export function suggestEnvName(path: string): string {
  return `AUTH_${path.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/\./g, "_").toUpperCase()}`;
}

export const envRefsSchema = z
  .record(
    z.string().refine((p) => ENV_PATHS.includes(p), { message: "Unknown setting" }),
    z
      .string()
      .trim()
      .regex(ENV_NAME_PATTERN, "Environment variable names must start with AUTH_ and use A-Z, 0-9 and _")
  )
  .default({});

export type EnvRefs = Record<string, string>;
