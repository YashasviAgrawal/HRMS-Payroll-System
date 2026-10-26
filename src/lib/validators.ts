import { z } from "zod";
import { isISODate } from "./dates";

/** Shared field rules (messages are i18n keys, translated by the API wrapper). */
export const MOBILE_RE = /^[6-9]\d{9}$/;

/** Accepts "+91 98765 43210", "098765 43210" or "9876543210" and keeps the 10 digits. */
export function normaliseMobile(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export const mobileField = z
  .string()
  .transform(normaliseMobile)
  .refine((v) => MOBILE_RE.test(v), "validation.mobile");

export const isoDateField = z.string().refine(isISODate, "validation.date");

export const loginIdField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{3,20}$/, "validation.loginId");

export const otpField = z.string().trim().regex(/^\d{6}$/, "validation.otp");

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const AADHAAR_RE = /^\d{12}$/;
