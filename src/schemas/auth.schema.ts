import { z } from "zod";

export const sendOtpSchema = z.object({
  phoneNumber: z
    .string({ required_error: "Phone number is required" })
    .min(7, "Phone number must be at least 7 characters")
    .max(20, "Phone number must not exceed 20 characters")
    .regex(/^\+?[0-9\s\-()]+$/, "Invalid phone number format"),
});

export const verifyOtpSchema = z.object({
  phoneNumber: z
    .string({ required_error: "Phone number is required" })
    .min(7, "Phone number is invalid"),
  otp: z
    .string({ required_error: "OTP is required" })
    .length(6, "OTP must be 6 digits"),
  clientType: z.enum(["web", "app"]).default("web"),
});

export const completeProfileSchema = z.object({
  tempToken: z
    .string({ required_error: "Registration verification token is required" })
    .min(10, "Invalid registration token"),
  name: z
    .string({ required_error: "Name is required" })
    .min(1, "Name cannot be empty")
    .max(255, "Name cannot exceed 255 characters"),
  age: z.coerce
    .number({ required_error: "Age is required" })
    .int("Age must be an integer")
    .min(1, "Age must be at least 1")
    .max(130, "Age must be realistic"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must not exceed 30 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain alphanumeric characters and underscores"
    )
    .optional(),
  email: z.string().email("Invalid email address").optional().nullable(),
  clientType: z.enum(["web", "app"]).default("web"),
});

export const refreshTokenSchema = z.object({
  refreshToken: z
    .string({ required_error: "Refresh token is required" })
    .min(20, "Invalid refresh token"),
});

export const checkUsernameSchema = z.object({
  username: z
    .string({ required_error: "Username is required" })
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must not exceed 30 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain alphanumeric characters and underscores"
    ),
});

export const getActivityQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
  sessionOnly: z.enum(["true", "false"]).optional(),
});

export type SendOtpInput = z.infer<typeof sendOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type CompleteProfileInput = z.infer<typeof completeProfileSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type CheckUsernameInput = z.infer<typeof checkUsernameSchema>;
export type GetActivityQueryInput = z.infer<typeof getActivityQuerySchema>;
