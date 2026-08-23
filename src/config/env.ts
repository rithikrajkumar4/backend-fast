import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

const nodeEnv = process.env.NODE_ENV || "development";

// Priority order of env files to load
const envFiles = [
  nodeEnv === "production" ? ".env.prod" : ".env.local",
  `.env.${nodeEnv}`,
  ".env",
];

for (const file of envFiles) {
  const envPath = path.resolve(process.cwd(), file);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  CORS_ORIGIN: z.string().default("*"),
  MORGAN_FORMAT: z.enum(["dev", "combined", "common", "short", "tiny"]).default("dev"),
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default("postgres"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME: z.string().default("fastify_db"),
  DB_SSL: z.preprocess((val) => val === "true" || val === "1" || val === true, z.boolean()).default(false),
  DB_MAX_CONNECTIONS: z.coerce.number().default(20),
  DB_SYNC: z.preprocess((val) => val === "true" || val === "1" || val === true, z.boolean()).default(true),
  DB_LOG: z.preprocess((val) => val === "true" || val === "1" || val === true, z.boolean()).default(false),
  JWT_SECRET: z.string().default("super-secret-jwt-key-change-in-production"),
  JWT_ACCESS_EXPIRY: z.string().default("15m"),
  REFRESH_TOKEN_WEB_EXPIRY_DAYS: z.coerce.number().default(7),
  REFRESH_TOKEN_APP_EXPIRY_DAYS: z.coerce.number().default(90),
  DEFAULT_OTP: z.string().default("123456"),
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Invalid environment variables:", result.error.format());
    process.exit(1);
  }
  return result.data;
};

export const env = parseEnv();
export type Env = z.infer<typeof envSchema>;
