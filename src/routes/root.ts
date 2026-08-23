import type { FastifyPluginAsync } from "fastify";
import { healthRoutes } from "./health/index.js";
import { v1Routes } from "./api/v1/index.js";

export const rootRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (_request, _reply) => {
    return {
      name: "Fastify Backend API",
      status: "online",
      documentation: "/docs (if enabled)",
      endpoints: {
        health: "/health",
        apiV1: "/api/v1/hello",
      },
    };
  });

  await fastify.register(healthRoutes, { prefix: "/health" });
  await fastify.register(v1Routes, { prefix: "/api/v1" });
};
