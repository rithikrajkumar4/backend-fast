import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import helmet from "@fastify/helmet";
import { env } from "./config/env.js";
import { corsPlugin } from "./plugins/cors.js";
import { morganPlugin } from "./plugins/morgan.js";
import { typeormPlugin } from "./plugins/typeorm.js";
import { sensiblePlugin } from "./plugins/sensible.js";
import { rootRoutes } from "./routes/root.js";

export async function buildApp(opts: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const loggerConfig =
    env.NODE_ENV === "development"
      ? {
          level: env.LOG_LEVEL,
          transport: {
            target: "pino-pretty",
            options: {
              translateTime: "HH:MM:ss Z",
              ignore: "pid,hostname",
            },
          },
        }
      : {
          level: env.LOG_LEVEL,
        };

  const app = Fastify({
    logger: loggerConfig,
    ...opts,
  });

  // Register Security & Core Plugins
  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === "production",
  });
  await app.register(corsPlugin);
  await app.register(morganPlugin);
  await app.register(typeormPlugin);
  await app.register(sensiblePlugin);

  // Register Application Routes
  await app.register(rootRoutes);

  // 404 Handler
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      statusCode: 404,
      error: "Not Found",
      message: `Route ${request.method}:${request.url} not found`,
    });
  });

  return app;
}
