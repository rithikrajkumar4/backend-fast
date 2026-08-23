import fp from "fastify-plugin";
import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../utils/errors.js";

const STATUS_NAMES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

async function errorHandlerPluginAsync(fastify: FastifyInstance) {
  fastify.setErrorHandler((error: FastifyError | AppError | ZodError | Error, request: FastifyRequest, reply: FastifyReply) => {
    // 1. Zod Validation Errors
    if (error instanceof ZodError) {
      const firstMessage = error.errors[0]?.message || "Validation failed";
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: firstMessage,
        details: error.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }

    // 2. Custom AppError instances
    if (error instanceof AppError) {
      const statusCode = error.statusCode;
      const errorName = STATUS_NAMES[statusCode] || "Error";
      return reply.status(statusCode).send({
        statusCode,
        error: errorName,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }

    // 3. Fastify HttpErrors (from @fastify/sensible or internal Fastify errors)
    const statusCode = (error as any).statusCode || (error as any).status || 500;
    const errorName = (error as any).name || STATUS_NAMES[statusCode] || "Internal Server Error";

    if (statusCode >= 500) {
      fastify.log.error(error, `Internal server error on ${request.method} ${request.url}`);
    }

    return reply.status(statusCode).send({
      statusCode,
      error: errorName,
      message: error.message || "An unexpected error occurred",
    });
  });
}

export const errorHandlerPlugin = fp(errorHandlerPluginAsync, {
  name: "error-handler-plugin",
});
