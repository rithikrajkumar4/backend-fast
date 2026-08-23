import type { FastifyRequest, FastifyReply } from "fastify";
import type { ZodSchema } from "zod";

/**
 * Fastify preValidation hook to validate and parse request body with a Zod schema.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      throw result.error;
    }
    request.body = result.data;
  };
}

/**
 * Fastify preValidation hook to validate and parse request query with a Zod schema.
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const result = schema.safeParse(request.query);
    if (!result.success) {
      throw result.error;
    }
    request.query = result.data;
  };
}

/**
 * Fastify preValidation hook to validate and parse request parameters with a Zod schema.
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const result = schema.safeParse(request.params);
    if (!result.success) {
      throw result.error;
    }
    request.params = result.data;
  };
}
