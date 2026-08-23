import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Repository } from "typeorm";
import { MoreThan } from "typeorm";
import { UserSession, type ClientType } from "../database/entities/session.entity.js";
import { User } from "../database/entities/user.entity.js";
import { env } from "../config/env.js";

export interface SessionMetadata {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface AuthTokens {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  clientType: ClientType;
}

export class SessionService {
  /**
   * Calculates the refresh token expiry date according to client type.
   * Web: short TTL (e.g. 7 days). App: long TTL (e.g. 90 days).
   */
  public static getRefreshTokenExpiry(clientType: ClientType): Date {
    const days =
      clientType === "app"
        ? env.REFRESH_TOKEN_APP_EXPIRY_DAYS
        : env.REFRESH_TOKEN_WEB_EXPIRY_DAYS;

    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  /**
   * Generates a cryptographically secure random refresh token.
   */
  public static generateRefreshToken(): string {
    return crypto.randomBytes(48).toString("hex");
  }

  /**
   * Creates a new user session, generates access & refresh tokens, and stores the session in DB.
   */
  public static async createSession(
    user: User,
    clientType: ClientType = "web",
    meta: SessionMetadata,
    fastify: FastifyInstance
  ): Promise<AuthTokens> {
    const sessionRepository: Repository<UserSession> = fastify.db.getRepository(UserSession);
    const refreshToken = this.generateRefreshToken();
    const refreshTokenExpiresAt = this.getRefreshTokenExpiry(clientType);

    const session = sessionRepository.create({
      userId: user.id,
      clientType,
      refreshToken,
      refreshTokenExpiresAt,
      userAgent: meta.userAgent || null,
      ipAddress: meta.ipAddress || null,
      isActive: true,
      lastActivityAt: new Date(),
    });

    const savedSession = await sessionRepository.save(session);

    const accessToken = fastify.jwt.sign({
      id: user.id,
      sessionId: savedSession.id,
      clientType,
      phoneNumber: user.phoneNumber,
      username: user.username,
    });

    return {
      sessionId: savedSession.id,
      accessToken,
      refreshToken,
      refreshTokenExpiresAt,
      clientType,
    };
  }

  /**
   * Refreshes an active session with token rotation.
   */
  public static async refreshSession(
    rawRefreshToken: string,
    meta: SessionMetadata,
    fastify: FastifyInstance
  ): Promise<{ tokens: AuthTokens; user: User } | null> {
    const sessionRepository: Repository<UserSession> = fastify.db.getRepository(UserSession);
    const userRepository: Repository<User> = fastify.db.getRepository(User);

    const session = await sessionRepository.findOne({
      where: {
        refreshToken: rawRefreshToken.trim(),
        isActive: true,
        refreshTokenExpiresAt: MoreThan(new Date()),
      },
    });

    if (!session) {
      return null;
    }

    const user = await userRepository.findOne({
      where: { id: session.userId, isActive: true },
    });

    if (!user) {
      return null;
    }

    // Token rotation: Issue a new refresh token and refresh expiry
    const newRefreshToken = this.generateRefreshToken();
    const newExpiry = this.getRefreshTokenExpiry(session.clientType);

    session.refreshToken = newRefreshToken;
    session.refreshTokenExpiresAt = newExpiry;
    session.lastActivityAt = new Date();
    if (meta.ipAddress) session.ipAddress = meta.ipAddress;
    if (meta.userAgent) session.userAgent = meta.userAgent;

    await sessionRepository.save(session);

    const accessToken = fastify.jwt.sign({
      id: user.id,
      sessionId: session.id,
      clientType: session.clientType,
      phoneNumber: user.phoneNumber,
      username: user.username,
    });

    return {
      tokens: {
        sessionId: session.id,
        accessToken,
        refreshToken: newRefreshToken,
        refreshTokenExpiresAt: newExpiry,
        clientType: session.clientType,
      },
      user,
    };
  }

  /**
   * Revokes a session (logout).
   */
  public static async revokeSession(
    sessionId: string,
    sessionRepository: Repository<UserSession>
  ): Promise<boolean> {
    const result = await sessionRepository.update(
      { id: sessionId, isActive: true },
      { isActive: false }
    );
    return (result.affected ?? 0) > 0;
  }
}
