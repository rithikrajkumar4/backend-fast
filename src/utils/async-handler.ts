import type { FastifyRequest, FastifyReply, RouteGenericInterface } from "fastify";

/**
 * Async handler wrapper to eliminate manual try/catch blocks in controllers.
 * Any thrown error (AppError, Error, ZodError) is automatically caught
 * and forwarded to Fastify's centralized error handler.
 */
export function asyncHandler<T extends RouteGenericInterface = RouteGenericInterface>(
  handler: (request: FastifyRequest<T>, reply: FastifyReply) => Promise<any> | any
) {
  return async (request: FastifyRequest<any>, reply: FastifyReply): Promise<any> => {
    return await handler(request, reply);
  };
}
