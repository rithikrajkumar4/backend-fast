import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { AppDataSource } from "../database/data-source.js";

declare module "fastify" {
  interface FastifyInstance {
    db: typeof AppDataSource;
  }
}

async function typeormPluginAsync(fastify: FastifyInstance) {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      fastify.log.info("🐘 TypeORM DataSource initialized successfully");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fastify.log.warn(`⚠️ TypeORM connection check: unable to connect to database (${message})`);
  }

  fastify.decorate("db", AppDataSource);

  fastify.addHook("onClose", async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
      fastify.log.info("TypeORM DataSource destroyed.");
    }
  });
}

export const typeormPlugin = fp(typeormPluginAsync, {
  name: "typeorm-plugin",
});
