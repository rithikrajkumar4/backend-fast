import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import fastifyPostgres from "@fastify/postgres";
import { env } from "../config/env.js";

async function postgresPluginAsync(fastify: FastifyInstance) {
  const pgConfig: {
    connectionString?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    max: number;
    ssl: boolean | { rejectUnauthorized: boolean };
  } = env.DATABASE_URL
    ? {
        connectionString: env.DATABASE_URL,
        max: env.DB_MAX_CONNECTIONS,
        ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
      }
    : {
        host: env.DB_HOST,
        port: env.DB_PORT,
        user: env.DB_USER,
        ...(env.DB_PASSWORD ? { password: env.DB_PASSWORD } : {}),
        database: env.DB_NAME,
        max: env.DB_MAX_CONNECTIONS,
        ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
      };

  await fastify.register(fastifyPostgres, pgConfig);

  fastify.addHook("onReady", async () => {
    try {
      const client = await fastify.pg.connect();
      const result = await client.query<{ now: Date }>("SELECT NOW() as now");
      client.release();
      fastify.log.info({ dbTime: result.rows[0].now }, "🐘 PostgreSQL connected successfully");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fastify.log.warn(`⚠️ PostgreSQL connection check: unable to connect to database (${message})`);
    }
  });
}

export const postgresPlugin = fp(postgresPluginAsync, {
  name: "postgres-plugin",
});
