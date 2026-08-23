import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (_request, _reply) => {
    let dbStatus = "not_configured";
    try {
      if (fastify.db?.isInitialized) {
        await fastify.db.query("SELECT 1");
        dbStatus = "connected";
      }
    } catch {
      dbStatus = "disconnected";
    }

    return {
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: dbStatus,
    };
  });

  fastify.get("/db", async (_request, reply) => {
    try {
      if (!fastify.db?.isInitialized) {
        return reply.status(503).send({
          status: "unavailable",
          message: "TypeORM DataSource is not initialized",
        });
      }
      const result = await fastify.db.query(
        "SELECT NOW() as now, current_database() as database, version() as version"
      );
      return {
        status: "connected",
        data: result[0],
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Database connection failed";
      return reply.status(503).send({
        status: "disconnected",
        error: message,
        timestamp: new Date().toISOString(),
      });
    }
  });
};
