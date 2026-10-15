// Auth Flow DTOs
import type { ClientType, AuthTokensDto } from "./session.dto.js";
import type { UserResponseDto } from "./user.dto.js";
import type { ApiResponse } from "./common.dto.js";

export type { AuthTokensDto, UserResponseDto };

// ======================= Request DTOs =======================

export interface SendOtpDto {
  phoneNumber?: string;
  email?: string;
  channel?: "sms" | "whatsapp";
}

export interface VerifyOtpDto {
  phoneNumber?: string;
  email?: string;
  otp: string;
  clientType?: ClientType;
}

export interface SsoLoginDto {
  idToken?: string;
  accessToken?: string;
  nonce?: string;
  name?: string;
  clientType?: ClientType;
}

export interface SsoProviderParamsDto {
  provider: "google" | "apple" | "facebook";
}

export interface CompleteProfileDto {
  tempToken: string;
  name: string;
  age: number;
  username?: string;
  email?: string | null;
  clientType?: ClientType;
}

export interface RefreshTokenDto {
  refreshToken: string;
}

export interface CheckUsernameDto {
  username: string;
}

// ======================= Response DTOs =======================

export interface SendOtpDataDto {
  phoneNumber?: string;
  email?: string;
  channel: "sms" | "whatsapp" | "email";
  isNewUser: boolean;
  expiresAt: Date;
  resendAvailableAt: Date;
  /** Present only outside production */
  otp?: string;
}

export type SendOtpResponseDto = ApiResponse<SendOtpDataDto>;

export interface VerifyOtpNewUserDataDto {
  phoneNumber?: string;
  email?: string;
  suggestedUsername: string;
  tempToken: string;
  /** Values the provider shared, to pre-fill the profile form after SSO */
  prefill?: { name: string | null; email: string | null };
}

export interface VerifyOtpExistingUserDataDto {
  user: UserResponseDto;
  tokens: AuthTokensDto;
}

export type VerifyOtpResponseDto =
  | {
      success: boolean;
      isNewUser: true;
      message: string;
      data: VerifyOtpNewUserDataDto;
    }
  | {
      success: boolean;
      isNewUser: false;
      message: string;
      data: VerifyOtpExistingUserDataDto;
    };

export interface CompleteProfileDataDto {
  user: UserResponseDto;
  tokens: AuthTokensDto;
}

export type CompleteProfileResponseDto = ApiResponse<CompleteProfileDataDto>;

export interface CheckUsernameResponseDto {
  username: string;
  isAvailable: boolean;
  message: string;
}

export interface UserMeDataDto {
  user: UserResponseDto;
  session: {
    id: string;
    clientType: ClientType;
    lastActivityAt: Date;
    createdAt: Date;
    isActive: boolean;
  } | null;
}

export type UserMeResponseDto = ApiResponse<UserMeDataDto>;
