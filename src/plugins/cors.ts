import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import cors from "@fastify/cors";
import { env } from "../config/env.js";

async function corsPluginAsync(fastify: FastifyInstance) {
  const origin = env.CORS_ORIGIN === "*" ? "*" : env.CORS_ORIGIN.split(",").map((o) => o.trim());

  await fastify.register(cors, {
    origin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
}

export const corsPlugin = fp(corsPluginAsync, {
  name: "cors-plugin",
});
