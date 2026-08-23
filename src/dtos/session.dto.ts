// UserSession Entity DTOs
import type { ClientType } from "../database/entities/session.entity.js";

export type { ClientType };

export interface SessionMetadataDto {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuthTokensDto {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  clientType: ClientType;
}

export interface SessionResponseDto {
  id: string;
  clientType: ClientType;
  lastActivityAt: Date;
  createdAt: Date;
  isActive: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}
