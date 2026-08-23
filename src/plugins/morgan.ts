import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import morgan from "morgan";
import { env } from "../config/env.js";

async function morganPluginAsync(fastify: FastifyInstance) {
  const logger = morgan(env.MORGAN_FORMAT);

  fastify.addHook("onRequest", (request, reply, done) => {
    logger(request.raw, reply.raw, (err) => {
      if (err) {
        done(err);
      } else {
        done();
      }
    });
  });
}

export const morganPlugin = fp(morganPluginAsync, {
  name: "morgan-plugin",
});
