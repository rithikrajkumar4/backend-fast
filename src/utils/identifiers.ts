import { AppError } from "./errors.js";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Normalizes a phone number to digits with an optional leading "+":
 * strips spaces, dashes, dots and parentheses, turns a "00" prefix into "+", and prepends
 * the configured default country code when the number has none.
 */
export function normalizePhone(raw: string, defaultCountryCode = ""): string {
  let phone = raw.trim().replace(/[\s\-().]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (!phone.startsWith("+") && defaultCountryCode) {
    phone = `${defaultCountryCode}${phone.replace(/^0+/, "")}`;
  }
  if (!/^\+?[0-9]{7,15}$/.test(phone)) {
    throw AppError.badRequest("Invalid phone number");
  }
  return phone;
}

/** Normalizes a test-account identifier, which may be an email or a phone number. */
export function normalizeIdentifier(identifier: string, defaultCountryCode = ""): string {
  return identifier.includes("@") ? normalizeEmail(identifier) : normalizePhone(identifier, defaultCountryCode);
}
