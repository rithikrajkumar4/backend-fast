import type { FastifyInstance } from "fastify";
import type { StorageService } from "../src/services/storage.service.js";

// Must be set before src/config/env.ts is evaluated (dotenv never overrides existing vars).
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL ??= "fatal";
process.env.DB_NAME = process.env.TEST_DB_NAME ?? "fastify_db_test";
process.env.DB_SYNC = "true";
process.env.DB_LOG = "false";
process.env.JWT_SECRET = "test-jwt-secret-key-12345";
process.env.DEFAULT_OTP = "123456";
process.env.S3_BUCKET = "test-bucket";
process.env.AWS_REGION = "us-east-1";
process.env.CDN_BASE_URL = "https://cdn.example.test";
process.env.SHARE_BASE_URL = "https://app.example.test/s";
process.env.AWS_ACCESS_KEY_ID ??= "AKIATESTTESTTESTTEST";
process.env.AWS_SECRET_ACCESS_KEY ??= "test-secret-access-key";

export const OTP = "123456";

export async function buildTestApp(deps: { storage?: StorageService } = {}): Promise<FastifyInstance> {
  const { buildApp } = await import("../src/app.js");
  const app = await buildApp({ logger: false }, deps);
  await app.ready();
  if (!app.db.isInitialized) {
    await app.close();
    throw new Error(`Test database '${process.env.DB_NAME}' is not reachable`);
  }
  return app;
}

let phoneSeq = 0;
/** Monotonic per-process and across runs, so it never collides with users from earlier runs. */
export function uniquePhone(): string {
  return `+1${Date.now() * 1000 + (phoneSeq++ % 1000)}`;
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
