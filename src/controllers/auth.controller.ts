import type { FastifyRequest, FastifyReply } from "fastify";
import { AuthService } from "../services/auth.service.js";
import { UsernameService } from "../services/username.service.js";
import { SessionService } from "../services/session.service.js";
import { User } from "../database/entities/user.entity.js";
import { UserSession } from "../database/entities/session.entity.js";
import { ActivityLog } from "../database/entities/activity-log.entity.js";
import { AppError } from "../utils/errors.js";
import type {
  SendOtpDto,
  VerifyOtpDto,
  CompleteProfileDto,
  RefreshTokenDto,
  CheckUsernameDto,
  GetActivityQueryDto,
} from "../dtos/index.js";

export class AuthController {
  /**
   * Send 6-digit OTP to phone number
   */
  public static async sendOtp(
    request: FastifyRequest<{ Body: SendOtpDto }>,
    reply: FastifyReply
  ) {
    const { phoneNumber } = request.body;
    const result = await AuthService.sendOtp(phoneNumber, request.server);

    return reply.status(200).send({
      success: true,
      message: result.isNewUser
        ? "OTP sent. User is not registered yet."
        : "OTP sent. Welcome back!",
      data: {
        phoneNumber: result.phoneNumber,
        isNewUser: result.isNewUser,
        otp: result.otp,
        expiresAt: result.expiresAt,
      },
    });
  }

  /**
   * Verify OTP (logs in existing user or returns suggested handle + tempToken for new user)
   */
  public static async verifyOtp(
    request: FastifyRequest<{ Body: VerifyOtpDto }>,
    reply: FastifyReply
  ) {
    const { phoneNumber, otp, clientType: bodyClientType } = request.body;
    const clientType =
      bodyClientType ||
      (request.headers["x-client-type"] === "app" ? "app" : "web");

    const meta = {
      ipAddress: (request.headers["x-forwarded-for"] as string) || request.ip || null,
      userAgent: (request.headers["user-agent"] as string) || null,
    };

    const result = await AuthService.verifyOtp(
      phoneNumber,
      otp,
      clientType,
      meta,
      request.server
    );

    if (result.isNewUser) {
      return reply.status(200).send({
        success: true,
        isNewUser: true,
        message: "OTP verified. Please complete your profile with name, age, and username.",
        data: {
          phoneNumber: result.phoneNumber,
          suggestedUsername: result.suggestedUsername,
          tempToken: result.tempToken,
        },
      });
    }

    return reply.status(200).send({
      success: true,
      isNewUser: false,
      message: "Login successful",
      data: {
        user: result.user,
        tokens: result.tokens,
      },
    });
  }

  /**
   * Complete registration for new user
   */
  public static async completeProfile(
    request: FastifyRequest<{ Body: CompleteProfileDto }>,
    reply: FastifyReply
  ) {
    const { tempToken, name, age, username, email, clientType: bodyClientType } = request.body;
    const clientType =
      bodyClientType ||
      (request.headers["x-client-type"] === "app" ? "app" : "web");

    const meta = {
      ipAddress: (request.headers["x-forwarded-for"] as string) || request.ip || null,
      userAgent: (request.headers["user-agent"] as string) || null,
    };

    const result = await AuthService.completeProfile(
      {
        tempToken,
        name,
        age,
        username,
        email,
        clientType,
        meta,
      },
      request.server
    );

    return reply.status(201).send({
      success: true,
      message: "Profile created and user logged in successfully",
      data: {
        user: result.user,
        tokens: result.tokens,
      },
    });
  }

  /**
   * Suggest a new unique collision-free username
   */
  public static async suggestUsername(
    request: FastifyRequest,
    _reply: FastifyReply
  ) {
    const userRepo = request.server.db.getRepository(User);
    const suggestedUsername = await UsernameService.generateUniqueUsername(userRepo);

    return {
      success: true,
      suggestedUsername,
    };
  }

  /**
   * Check if a custom username is available
   */
  public static async checkUsername(
    request: FastifyRequest<{ Body: CheckUsernameDto }>,
    _reply: FastifyReply
  ) {
    const { username } = request.body;
    const userRepo = request.server.db.getRepository(User);
    const isAvailable = await UsernameService.isUsernameAvailable(username, userRepo);

    return {
      username,
      isAvailable,
      message: isAvailable
        ? "Username is available!"
        : "Username is already taken. Please try another one.",
    };
  }

  /**
   * Refresh active session token
   */
  public static async refreshToken(
    request: FastifyRequest<{ Body: RefreshTokenDto }>,
    _reply: FastifyReply
  ) {
    const { refreshToken } = request.body;
    const meta = {
      ipAddress: (request.headers["x-forwarded-for"] as string) || request.ip || null,
      userAgent: (request.headers["user-agent"] as string) || null,
    };

    const result = await SessionService.refreshSession(
      refreshToken,
      meta,
      request.server
    );

    if (!result) {
      throw AppError.unauthorized("Invalid, expired, or revoked refresh token");
    }

    return {
      success: true,
      message: "Token refreshed successfully",
      data: {
        user: result.user,
        tokens: result.tokens,
      },
    };
  }

  /**
   * Revoke active session (Logout)
   */
  public static async logout(
    request: FastifyRequest,
    _reply: FastifyReply
  ) {
    const sessionId = request.user?.sessionId;
    if (!sessionId) {
      throw AppError.badRequest("No active session found");
    }

    const sessionRepo = request.server.db.getRepository(UserSession);
    await SessionService.revokeSession(sessionId, sessionRepo);

    return {
      success: true,
      message: "Successfully logged out and session revoked",
    };
  }

  /**
   * Get current authenticated user profile & session
   */
  public static async getMe(
    request: FastifyRequest,
    _reply: FastifyReply
  ) {
    const userId = request.user?.id;
    const sessionId = request.user?.sessionId;

    const userRepo = request.server.db.getRepository(User);
    const sessionRepo = request.server.db.getRepository(UserSession);

    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw AppError.notFound("User not found");
    }

    const session = sessionId
      ? await sessionRepo.findOne({ where: { id: sessionId } })
      : null;

    return {
      success: true,
      data: {
        user,
        session: session
          ? {
              id: session.id,
              clientType: session.clientType,
              lastActivityAt: session.lastActivityAt,
              createdAt: session.createdAt,
              isActive: session.isActive,
            }
          : null,
      },
    };
  }

  /**
   * Backtrack user activity trail across requests and sessions
   */
  public static async getActivity(
    request: FastifyRequest<{ Querystring: GetActivityQueryDto }>,
    _reply: FastifyReply
  ) {
    const userId = request.user?.id;
    const sessionId = request.user?.sessionId;
    const limit = Math.min(Number(request.query.limit) || 50, 100);

    const activityRepo = request.server.db.getRepository(ActivityLog);

    const whereClause: any = { userId };
    if (request.query.sessionOnly === "true" && sessionId) {
      whereClause.sessionId = sessionId;
    }

    const activities = await activityRepo.find({
      where: whereClause,
      order: { createdAt: "DESC" },
      take: limit,
    });

    return {
      success: true,
      currentSessionId: sessionId,
      count: activities.length,
      activities: activities.map((act) => ({
        requestId: act.requestId,
        sessionId: act.sessionId,
        method: act.method,
        route: act.route,
        url: act.url,
        statusCode: act.statusCode,
        durationMs: act.durationMs,
        timestamp: act.createdAt,
      })),
    };
  }
}
