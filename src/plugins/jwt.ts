import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { env } from "../config/env.js";
import { UserSession } from "../database/entities/session.entity.js";
import { AdminUser } from "../database/entities/admin-user.entity.js";
import type { SsoProvider } from "../database/entities/auth-identity.entity.js";

export interface JwtUserPayload {
  id: string;
  sessionId: string;
  clientType: "web" | "app";
  phoneNumber?: string;
  email?: string;
  username?: string;
}

/** Short-lived proof that a phone/email/SSO identity was verified, exchanged at /complete-profile. */
export interface TempRegistrationPayload {
  purpose: "registration";
  phoneNumber?: string;
  email?: string;
  identity?: { provider: SsoProvider; providerUserId: string; email: string | null };
}

export interface AdminJwtPayload {
  kind: "admin";
  adminId: string;
  username: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtUserPayload | TempRegistrationPayload | AdminJwtPayload;
    user: JwtUserPayload;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    admin?: AdminUser;
  }
}

function unauthorized(reply: FastifyReply, message = "Invalid or expired token") {
  return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message });
}

async function jwtPluginAsync(fastify: FastifyInstance) {
  await fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: env.JWT_ACCESS_EXPIRY,
    },
  });

  /**
   * App users: accepts only session access tokens (not registration or admin tokens) whose
   * session is still active, so logout revokes access tokens immediately.
   */
  fastify.decorate(
    "authenticate",
    async function (request: FastifyRequest, reply: FastifyReply) {
      let payload: Partial<JwtUserPayload> & { purpose?: string; kind?: string };
      try {
        payload = await request.jwtVerify();
      } catch {
        return unauthorized(reply);
      }
      if (!payload.id || !payload.sessionId || payload.purpose || payload.kind) {
        return unauthorized(reply);
      }
      const session = await fastify.db.getRepository(UserSession).findOne({
        where: { id: payload.sessionId, userId: payload.id, isActive: true },
        select: { id: true },
      });
      if (!session) {
        return unauthorized(reply, "Session has been revoked");
      }
    }
  );

  /** Admin panel: accepts only admin tokens for an admin that still exists and is active. */
  fastify.decorate(
    "authenticateAdmin",
    async function (request: FastifyRequest, reply: FastifyReply) {
      let payload: Partial<AdminJwtPayload>;
      try {
        payload = await request.jwtVerify();
      } catch {
        return unauthorized(reply);
      }
      if (payload.kind !== "admin" || !payload.adminId) {
        return unauthorized(reply);
      }
      const admin = await fastify.db.getRepository(AdminUser).findOneBy({ id: payload.adminId, isActive: true });
      if (!admin) {
        return unauthorized(reply);
      }
      request.admin = admin;
    }
  );
}

export const jwtPlugin = fp(jwtPluginAsync, {
  name: "jwt-plugin",
});
