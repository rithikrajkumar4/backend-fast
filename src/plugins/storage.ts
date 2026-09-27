import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { S3StorageService, type StorageService } from "../services/storage.service.js";

declare module "fastify" {
  interface FastifyInstance {
    storage: StorageService;
  }
}

export interface StoragePluginOptions {
  /** Override the S3-backed implementation (used by tests). */
  storage?: StorageService;
}

async function storagePluginAsync(fastify: FastifyInstance, opts: StoragePluginOptions) {
  fastify.decorate("storage", opts.storage ?? new S3StorageService());
}

export const storagePlugin = fp(storagePluginAsync, {
  name: "storage-plugin",
});
