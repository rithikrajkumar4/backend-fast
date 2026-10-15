import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";

/**
 * Per-IP rate limiting, opt-in per route via `config: perMinute(n)`.
 * Disabled with RATE_LIMIT_ENABLED=false (e.g. for tests that hammer one IP).
 */
async function rateLimitPluginAsync(fastify: FastifyInstance) {
  if (!env.RATE_LIMIT_ENABLED) return;
  await fastify.register(rateLimit, { global: false });
}

/** Route config limiting each IP to `max` requests per minute. */
export const perMinute = (max: number) => ({ rateLimit: { max, timeWindow: "1 minute" } });

export const rateLimitPlugin = fp(rateLimitPluginAsync, {
  name: "rate-limit-plugin",
});
