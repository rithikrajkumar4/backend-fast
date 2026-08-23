import type { FastifyPluginAsync } from "fastify";
import { AuthController } from "../../../controllers/auth.controller.js";
import { asyncHandler } from "../../../utils/async-handler.js";
import { validateBody, validateQuery } from "../../../middlewares/validate.js";
import {
  sendOtpSchema,
  verifyOtpSchema,
  completeProfileSchema,
  refreshTokenSchema,
  checkUsernameSchema,
  getActivityQuerySchema,
} from "../../../schemas/auth.schema.js";

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Request OTP for Phone Number (New or Existing user)
   */
  fastify.post(
    "/send-otp",
    { preValidation: [validateBody(sendOtpSchema)] },
    asyncHandler(AuthController.sendOtp)
  );

  /**
   * Verify OTP (Direct login for existing users, or suggested username + tempToken for new users)
   */
  fastify.post(
    "/verify-otp",
    { preValidation: [validateBody(verifyOtpSchema)] },
    asyncHandler(AuthController.verifyOtp)
  );

  /**
   * Complete registration & profile for new users
   */
  fastify.post(
    "/complete-profile",
    { preValidation: [validateBody(completeProfileSchema)] },
    asyncHandler(AuthController.completeProfile)
  );

  /**
   * Generate fresh DB-verified unique username suggestion
   */
  fastify.get(
    "/suggest-username",
    asyncHandler(AuthController.suggestUsername)
  );

  /**
   * Check if a custom username is available
   */
  fastify.post(
    "/check-username",
    { preValidation: [validateBody(checkUsernameSchema)] },
    asyncHandler(AuthController.checkUsername)
  );

  /**
   * Refresh Token & rotate session tokens
   */
  fastify.post(
    "/refresh-token",
    { preValidation: [validateBody(refreshTokenSchema)] },
    asyncHandler(AuthController.refreshToken)
  );

  /**
   * Revoke active session (Logout)
   */
  fastify.post(
    "/logout",
    { preHandler: [fastify.authenticate] },
    asyncHandler(AuthController.logout)
  );

  /**
   * Get Current Authenticated User & Session Profile
   */
  fastify.get(
    "/me",
    { preHandler: [fastify.authenticate] },
    asyncHandler(AuthController.getMe)
  );

  /**
   * Backtrack user activity trail across requests and sessions
   */
  fastify.get(
    "/activity",
    {
      preHandler: [fastify.authenticate],
      preValidation: [validateQuery(getActivityQuerySchema)],
    },
    asyncHandler(AuthController.getActivity)
  );
};
