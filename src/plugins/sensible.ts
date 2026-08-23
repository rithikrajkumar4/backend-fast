import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import sensible from "@fastify/sensible";

async function sensiblePluginAsync(fastify: FastifyInstance) {
  await fastify.register(sensible);
}

export const sensiblePlugin = fp(sensiblePluginAsync, {
  name: "sensible-plugin",
});
