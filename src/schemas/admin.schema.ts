import { z } from "zod";

const password = z
  .string({ required_error: "Password is required" })
  .min(10, "Password must be at least 10 characters")
  .max(200, "Password must not exceed 200 characters");

export const adminLoginSchema = z.object({
  email: z.string({ required_error: "Email is required" }).trim().toLowerCase().email("Invalid email address"),
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
