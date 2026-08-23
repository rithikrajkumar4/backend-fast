import type { FastifyPluginAsync } from "fastify";
import { User } from "../../../database/entities/user.entity.js";

export const v1Routes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/hello", async (request, _reply) => {
    const { name = "World" } = (request.query as { name?: string }) || {};
    return {
      message: `Hello, ${name}!`,
      version: "v1",
      timestamp: new Date().toISOString(),
    };
  });

  fastify.post("/echo", async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== "object") {
      return reply.badRequest("Request body must be a valid JSON object");
    }
    return {
      received: body,
      timestamp: new Date().toISOString(),
    };
  });

  // TypeORM Raw Query Example
  fastify.get("/db-time", async (_request, reply) => {
    try {
      const result = await fastify.db.query("SELECT NOW() as now");
      return {
        dbTime: result[0].now,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Database query failed";
      return reply.serviceUnavailable(`Database unavailable: ${message}`);
    }
  });

  // TypeORM Entity CRUD Example
  fastify.get("/users", async (_request, reply) => {
    try {
      const userRepository = fastify.db.getRepository(User);
      const users = await userRepository.find({
        order: { createdAt: "DESC" },
        take: 50,
      });
      return { count: users.length, users };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch users";
      return reply.serviceUnavailable(`Database error: ${message}`);
    }
  });

  fastify.post("/users", async (request, reply) => {
    try {
      const body = request.body as { name?: string; email?: string; isActive?: boolean };
      if (!body || !body.name || !body.email) {
        return reply.badRequest("Missing required fields: 'name' and 'email'");
      }

      const userRepository = fastify.db.getRepository(User);
      const newUser = userRepository.create({
        name: body.name,
        email: body.email,
        isActive: body.isActive ?? true,
      });

      const savedUser = await userRepository.save(newUser);
      return reply.status(201).send(savedUser);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create user";
      return reply.badRequest(`Error: ${message}`);
    }
  });
};
