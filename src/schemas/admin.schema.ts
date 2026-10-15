import { z } from "zod";

const password = z
  .string({ required_error: "Password is required" })
  .min(10, "Password must be at least 10 characters")
  .max(200, "Password must not exceed 200 characters");

export const adminUsernameSchema = z
  .string({ required_error: "Username is required" })
  .trim()
  .toLowerCase()
  .min(3, "Username must be at least 3 characters")
  .max(255, "Username must not exceed 255 characters")
  .regex(/^[a-z0-9._@+-]+$/, "Username can only contain letters, numbers and . _ @ + -");

export const adminLoginSchema = z.object({
  username: z.string({ required_error: "Username is required" }).trim().toLowerCase().min(1, "Username is required").max(255),
  password: z.string({ required_error: "Password is required" }).min(1, "Password is required").max(200),
});

export const adminChangePasswordSchema = z.object({
  currentPassword: z.string({ required_error: "Current password is required" }).min(1).max(200),
  newPassword: password,
});

export const adminTestDeliverySchema = z.object({
  channel: z.enum(["sms", "whatsapp", "email"]),
  to: z.string({ required_error: "Recipient is required" }).trim().min(3).max(255),
});

export const adminPasswordSchema = password;

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type AdminChangePasswordInput = z.infer<typeof adminChangePasswordSchema>;
export type AdminTestDeliveryInput = z.infer<typeof adminTestDeliverySchema>;
