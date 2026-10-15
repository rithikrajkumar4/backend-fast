import crypto from "node:crypto";
import { promisify } from "node:util";
import { env } from "../config/env.js";

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions
) => Promise<Buffer>;

// ======================= Secrets at rest (AES-256-GCM) =======================

const SECRET_PREFIX = "enc:v1:";

/**
 * Key for encrypting secrets stored in the database (provider API keys, SMTP password...).
 * Uses CONFIG_ENCRYPTION_KEY, falling back to a key derived from JWT_SECRET.
 */
const encryptionKey = crypto
  .createHash("sha256")
  .update(env.CONFIG_ENCRYPTION_KEY || `${env.JWT_SECRET}:config-encryption`)
  .digest();

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return SECRET_PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/**
 * Decrypts a value produced by encryptSecret. Returns "" when the value can't be decrypted
 * (e.g. the encryption key changed), so a bad secret disables a provider instead of crashing.
 */
export function decryptSecret(stored: string): string {
  if (!stored) return "";
  if (!stored.startsWith(SECRET_PREFIX)) return stored;
  try {
    const raw = Buffer.from(stored.slice(SECRET_PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

// ======================= Password hashing (scrypt) =======================

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

// ======================= One-time codes =======================

/** Uniformly random numeric code of the given length. */
export function generateNumericCode(length: number): string {
  let code = "";
  for (let i = 0; i < length; i++) code += crypto.randomInt(0, 10).toString();
  return code;
}

/** Codes are stored as an HMAC bound to their target, never in plain text. */
export function hashCode(target: string, code: string): string {
  return crypto.createHmac("sha256", env.JWT_SECRET).update(`${target}:${code}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
