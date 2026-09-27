import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { MediaService } from "../services/media.service.js";
import { env } from "../config/env.js";

/** Periodically removes upload reservations whose presigned URL expired unused. */
async function mediaCleanupPluginAsync(fastify: FastifyInstance) {
  if (env.NODE_ENV === "test") return;

  let timer: NodeJS.Timeout | undefined;
  fastify.addHook("onReady", async () => {
    timer = setInterval(() => {
      if (!fastify.db?.isInitialized) return;
      MediaService.purgeStalePending(fastify)
        .then((count) => count && fastify.log.info(`Purged ${count} stale pending uploads`))
        .catch((err) => fastify.log.warn(`Stale upload cleanup failed: ${err.message}`));
    }, 15 * 60 * 1000);
    timer.unref();
  });
  fastify.addHook("onClose", async () => clearInterval(timer));
}

export const mediaCleanupPlugin = fp(mediaCleanupPluginAsync, {
  name: "media-cleanup-plugin",
  dependencies: ["typeorm-plugin", "storage-plugin"],
});
