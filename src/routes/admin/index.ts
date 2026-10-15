import type { FastifyPluginAsync } from "fastify";
import { AdminController } from "../../controllers/admin.controller.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { validateBody } from "../../middlewares/validate.js";
import { perMinute } from "../../plugins/rate-limit.js";
import {
  adminLoginSchema,
  adminChangePasswordSchema,
  adminTestDeliverySchema,
} from "../../schemas/admin.schema.js";

/** Admin API used by the panel at /admin. Every route except login needs an admin token. */
export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/auth/login",
    { preValidation: [validateBody(adminLoginSchema)], config: perMinute(10) },
    asyncHandler(AdminController.login)
  );

  await fastify.register(async (secured) => {
    secured.addHook("onRequest", fastify.authenticateAdmin);

    secured.get("/auth/me", asyncHandler(AdminController.me));
    secured.post(
      "/auth/change-password",
      { preValidation: [validateBody(adminChangePasswordSchema)], config: perMinute(10) },
      asyncHandler(AdminController.changePassword)
    );

    secured.get("/overview", asyncHandler(AdminController.getOverview));

    // Auth configuration (login methods, OTP policy, SSO, delivery providers)
    secured.get("/settings/auth", asyncHandler(AdminController.getAuthSettings));
    secured.put("/settings/auth", asyncHandler(AdminController.updateAuthSettings));
    secured.get(
      "/settings/auth/status",
      { config: perMinute(30) },
      asyncHandler(AdminController.getAuthStatus)
    );
    secured.post(
      "/settings/auth/test-delivery",
      { preValidation: [validateBody(adminTestDeliverySchema)], config: perMinute(10) },
      asyncHandler(AdminController.testDelivery)
    );
  });
};
