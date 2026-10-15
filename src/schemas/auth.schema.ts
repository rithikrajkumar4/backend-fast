import { z } from "zod";

const phoneNumberField = z
  .string({ required_error: "Phone number is required", invalid_type_error: "Phone number must be a string" })
  .min(7, "Phone number must be at least 7 characters")
  .max(20, "Phone number must not exceed 20 characters")
  .regex(/^\+?[0-9\s\-().]+$/, "Invalid phone number format");

const emailField = z
  .string({ invalid_type_error: "Email must be a string" })
  .trim()
  .max(255, "Email must not exceed 255 characters")
  .email("Invalid email address");

// Body clientType has no default so the x-client-type header can act as the fallback
const clientTypeField = z.enum(["web", "app"]).optional();

/** Either `phoneNumber` (with an optional `channel`) or `email`, never both. */
const otpTargetSchema = z
  .object({
    phoneNumber: phoneNumberField.optional(),
    email: emailField.optional(),
    channel: z.enum(["sms", "whatsapp"]).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.phoneNumber && !val.email) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["phoneNumber"], message: "Phone number or email is required" });
    }
    if (val.phoneNumber && val.email) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "Send either a phone number or an email, not both" });
    }
    if (val.email && val.channel) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["channel"], message: "channel only applies to phone numbers" });
    }
  });

export const sendOtpSchema = otpTargetSchema;

export const verifyOtpSchema = z
  .object({
    phoneNumber: phoneNumberField.optional(),
    email: emailField.optional(),
    otp: z
      .string({ required_error: "OTP is required" })
      .trim()
      .regex(/^[0-9]{4,8}$/, "OTP must be 4-8 digits"),
    clientType: clientTypeField,
  })
  .superRefine((val, ctx) => {
    if (!val.phoneNumber && !val.email) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["phoneNumber"], message: "Phone number or email is required" });
    }
    if (val.phoneNumber && val.email) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "Send either a phone number or an email, not both" });
    }
  });

export const ssoProviderParamsSchema = z.object({
  provider: z.enum(["google", "apple", "facebook"], {
    errorMap: () => ({ message: "Provider must be google, apple or facebook" }),
  }),
});

export const ssoLoginSchema = z
  .object({
    idToken: z.string().min(20, "Invalid idToken").max(8192).optional(),
    accessToken: z.string().min(20, "Invalid accessToken").max(4096).optional(),
    nonce: z.string().min(1).max(512).optional(),
    // Apple only shares the user's name with the app, on the first sign-in
    name: z.string().trim().min(1).max(255).optional(),
    clientType: clientTypeField,
  })
  .refine((val) => !!val.idToken || !!val.accessToken, {
    message: "idToken or accessToken is required",
    path: ["idToken"],
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
  clientType: clientTypeField,
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
export type SsoLoginInput = z.infer<typeof ssoLoginSchema>;
export type GetActivityQueryInput = z.infer<typeof getActivityQuerySchema>;
