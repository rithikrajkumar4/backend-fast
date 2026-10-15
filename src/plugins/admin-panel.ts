import path from "node:path";
import { fileURLToPath } from "node:url";
import fp from "fastify-plugin";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { adminRoutes } from "../routes/admin/index.js";

// <root>/public/admin, both from src/plugins (tsx) and dist/plugins (build)
const ADMIN_UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/admin");

/** Admin API at /api/admin and the static admin panel at /admin. Off when ADMIN_PANEL_ENABLED=false. */
async function adminPanelPluginAsync(fastify: FastifyInstance) {
  if (!env.ADMIN_PANEL_ENABLED) return;

  await fastify.register(adminRoutes, { prefix: "/api/admin" });

  await fastify.register(fastifyStatic, {
    root: ADMIN_UI_ROOT,
    prefix: "/admin/",
    decorateReply: false,
    setHeaders: (res) => {
      res.header("Cache-Control", "no-cache");
      res.header("X-Robots-Tag", "noindex");
    },
  });
  fastify.get("/admin", (_request, reply) => reply.redirect("/admin/"));
}

export const adminPanelPlugin = fp(adminPanelPluginAsync, {
  name: "admin-panel-plugin",
  dependencies: ["jwt-plugin"],
});
