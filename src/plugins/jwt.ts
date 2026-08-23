import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { env } from "../config/env.js";

export interface JwtUserPayload {
  id: string;
  sessionId: string;
  clientType: "web" | "app";
  phoneNumber?: string;
  username?: string;
}

export interface TempRegistrationPayload {
  phoneNumber: string;
  isOtpVerified: boolean;
  purpose: "registration";
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtUserPayload | TempRegistrationPayload;
    user: JwtUserPayload;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function jwtPluginAsync(fastify: FastifyInstance) {
  await fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: env.JWT_ACCESS_EXPIRY,
    },
  });

  fastify.decorate(
    "authenticate",
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.status(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message: "Invalid or expired token",
        });
      }
    }
  );
}

export const jwtPlugin = fp(jwtPluginAsync, {
  name: "jwt-plugin",
});
