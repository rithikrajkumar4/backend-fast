import type { FastifyInstance } from "fastify";
import type { StorageService } from "../src/services/storage.service.js";
import type { OtpMessage, OtpSender } from "../src/services/delivery.service.js";
import type { IdentityVerifier } from "../src/services/identity-verifier.service.js";

// Must be set before src/config/env.ts is evaluated (dotenv never overrides existing vars).
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL ??= "fatal";
process.env.DB_NAME = process.env.TEST_DB_NAME ?? "fastify_db_test";
process.env.DB_SYNC = "true";
process.env.DB_LOG = "false";
process.env.JWT_SECRET = "test-jwt-secret-key-12345";
process.env.DEFAULT_OTP = "123456";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.S3_BUCKET = "test-bucket";
process.env.AWS_REGION = "us-east-1";
process.env.CDN_BASE_URL = "https://cdn.example.test";
process.env.SHARE_BASE_URL = "https://app.example.test/s";
process.env.AWS_ACCESS_KEY_ID ??= "AKIATESTTESTTESTTEST";
process.env.AWS_SECRET_ACCESS_KEY ??= "test-secret-access-key";

export const OTP = "123456";

/** Messages "sent" during tests, newest last. */
export const sentMessages: OtpMessage[] = [];
export const captureSender: OtpSender = async (message) => {
  sentMessages.push(message);
};

export const GOOGLE_CLIENT_ID = "test-google-client.apps.googleusercontent.com";
export const APPLE_CLIENT_ID = "com.example.testapp";
export const FACEBOOK_APP_ID = "1234567890";

/** Auth settings every test file starts from: all methods on, no resend throttling. */
export const TEST_AUTH_SETTINGS = {
  appName: "TestApp",
  email: { enabled: true },
  phone: { enabled: true, sms: true, whatsapp: true, defaultChannel: "sms" },
  otp: { length: 6, ttlSeconds: 300, maxAttempts: 5, resendCooldownSeconds: 0, maxSendsPerHour: 1000 },
  testAccounts: [],
  sso: {
    autoLinkByVerifiedEmail: true,
    google: { enabled: true, clientIds: [GOOGLE_CLIENT_ID] },
    apple: { enabled: true, clientIds: [APPLE_CLIENT_ID] },
    facebook: { enabled: true, appId: FACEBOOK_APP_ID, appSecret: "test-facebook-secret" },
  },
};

export async function setAuthSettings(app: FastifyInstance, patch: Record<string, unknown> = {}) {
  const { SettingsService } = await import("../src/services/settings.service.js");
  return SettingsService.updateAuthSettings(deepMerge(structuredClone(TEST_AUTH_SETTINGS), patch), null, app);
}

function deepMerge(target: any, patch: any): any {
  for (const [key, value] of Object.entries(patch)) {
    target[key] =
      value && typeof value === "object" && !Array.isArray(value) && target[key] && typeof target[key] === "object"
        ? deepMerge(target[key], value)
        : value;
  }
  return target;
}

export async function buildTestApp(
  deps: { storage?: StorageService; otpSender?: OtpSender; identityVerifier?: IdentityVerifier } = {}
): Promise<FastifyInstance> {
  const { buildApp } = await import("../src/app.js");
  const app = await buildApp({ logger: false }, { otpSender: captureSender, ...deps });
  await app.ready();
  if (!app.db.isInitialized) {
    await app.close();
    throw new Error(`Test database '${process.env.DB_NAME}' is not reachable`);
  }
  await setAuthSettings(app);
  return app;
}

let phoneSeq = 0;
/**
 * Unique across runs (millisecond clock + per-process counter) and a valid E.164 length (14 digits).
 */
export function uniquePhone(): string {
  return `+1${String(Date.now()).slice(-10)}${String(phoneSeq++ % 1000).padStart(3, "0")}`;
}

export function uniqueHandle(prefix = "t"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export async function sendOtp(app: FastifyInstance, phoneNumber: string) {
  return app.inject({ method: "POST", url: "/api/v1/auth/send-otp", payload: { phoneNumber } });
}

export async function verifyOtp(
  app: FastifyInstance,
  phoneNumber: string,
  otp = OTP,
  extra: Record<string, unknown> = {}
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/verify-otp",
    payload: { phoneNumber, otp, ...extra },
  });
}

/** Runs send-otp → verify-otp and returns the registration temp token. */
export async function getTempToken(app: FastifyInstance, phoneNumber = uniquePhone()) {
  await sendOtp(app, phoneNumber);
  const res = await verifyOtp(app, phoneNumber);
  return { phoneNumber, tempToken: res.json().data.tempToken as string };
}

/** Full registration flow; returns the created user and session tokens. */
export async function registerUser(
  app: FastifyInstance,
  overrides: { username?: string; email?: string; clientType?: "web" | "app" } = {}
) {
  const { phoneNumber, tempToken } = await getTempToken(app);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/complete-profile",
    payload: { tempToken, name: "Test User", age: 25, ...overrides },
  });
  if (res.statusCode !== 201) throw new Error(`registerUser failed: ${res.body}`);
  const { user, tokens } = res.json().data;
  return { phoneNumber, user, tokens } as {
    phoneNumber: string;
    user: { id: string; username: string; phoneNumber: string; email: string | null };
    tokens: {
      sessionId: string;
      accessToken: string;
      refreshToken: string;
      refreshTokenExpiresAt: string;
      clientType: "web" | "app";
    };
  };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
