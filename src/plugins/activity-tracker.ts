import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ActivityLog } from "../database/entities/activity-log.entity.js";
import { UserSession } from "../database/entities/session.entity.js";

async function activityTrackerPluginAsync(fastify: FastifyInstance) {
  fastify.addHook("onRequest", async (request: FastifyRequest) => {
    (request as any)._startTime = process.hrtime();
  });

  fastify.addHook(
    "onResponse",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Don't track static health checks to avoid noise unless desired
      if (request.url.startsWith("/health")) {
        return;
      }

      const startTime = (request as any)._startTime;
      let durationMs = 0;
      if (startTime) {
        const diff = process.hrtime(startTime);
        durationMs = Number(((diff[0] * 1e9 + diff[1]) / 1e6).toFixed(2));
      }

      const user = request.user as { id?: string; sessionId?: string } | undefined;
      const userId = user?.id || null;
      const sessionId = user?.sessionId || null;
      const requestId = String(request.id || request.headers["x-request-id"] || "");
      const route = request.routeOptions?.url || request.url;
      const url = request.url;
      const method = request.method;
      const statusCode = reply.statusCode;
      const ipAddress = (request.headers["x-forwarded-for"] as string) || request.ip || null;
      const userAgent = (request.headers["user-agent"] as string) || null;

      try {
        if (fastify.db?.isInitialized) {
          const activityRepo = fastify.db.getRepository(ActivityLog);
          const log = activityRepo.create({
            requestId,
            sessionId,
            userId,
            method,
            route,
            url,
            statusCode,
            ipAddress: typeof ipAddress === "string" ? ipAddress.slice(0, 45) : null,
            userAgent: typeof userAgent === "string" ? userAgent.slice(0, 500) : null,
            durationMs,
          });

          // Non-blocking save
          activityRepo.save(log).catch((err) => {
            fastify.log.debug(`Failed to persist activity log: ${err.message}`);
          });

          // Update session lastActivityAt if sessionId is present
          if (sessionId) {
            const sessionRepo = fastify.db.getRepository(UserSession);
            sessionRepo
              .update(sessionId, { lastActivityAt: new Date() })
              .catch((err) => {
                fastify.log.debug(`Failed to update session activity: ${err.message}`);
              });
          }
        }
      } catch (err) {
        fastify.log.debug(`Activity tracker error: ${err}`);
      }
    }
  );
}

export const activityTrackerPlugin = fp(activityTrackerPluginAsync, {
  name: "activity-tracker-plugin",
  dependencies: ["typeorm-plugin"],
});
