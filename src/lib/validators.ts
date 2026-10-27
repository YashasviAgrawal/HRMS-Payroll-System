import { z } from "zod";
import { isISODate } from "./dates";

// These rules also run in the browser, where the Content Security Policy forbids eval: without this,
// zod tries `new Function` once to test for it and the browser reports a policy violation.
z.config({ jitless: true });

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

/**
 * Optional number from a form: "", null or undefined become null. Checks the blank case first,
 * because `z.coerce.number()` would quietly turn "" into 0.
 */
export function optionalNumber(rule: z.ZodNumber) {
  return z.preprocess((v) => (v === "" || v === null || v === undefined || (typeof v === "string" && v.trim() === "") ? null : v), z.coerce.number().pipe(rule).nullable());
}

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const AADHAAR_RE = /^\d{12}$/;

// ── Identity numbers (EM-03) ─────────────────────────────────────────────────

/** PAN of an individual: 5 letters (4th is "P" for a person), 4 digits, 1 letter. */
export function isValidPan(value: string): boolean {
  const v = value.trim().toUpperCase();
  return PAN_RE.test(v) && v[3] === "P";
}

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/** Check digit UIDAI uses for Aadhaar (Verhoeff). */
export function verhoeffCheckDigit(digits: string): number {
  let c = 0;
  const rev = digits.split("").reverse();
  for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][Number(rev[i])]];
  return VERHOEFF_INV[c];
}

/** Aadhaar: 12 digits, does not start with 0 or 1, and passes the Verhoeff checksum. */
export function isValidAadhaar(value: string): boolean {
  const v = value.replace(/[\s-]/g, "");
  if (!AADHAAR_RE.test(v) || v[0] === "0" || v[0] === "1") return false;
  let c = 0;
  const rev = v.split("").reverse();
  for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(rev[i])]];
  return c === 0;
}

export const isValidIfsc = (v: string) => IFSC_RE.test(v.trim().toUpperCase());
export const isValidBankAccount = (v: string) => /^\d{9,18}$/.test(v.replace(/\s/g, ""));
/** PRAN (NPS) and UAN (EPFO) are both 12 digits; the ESIC insurance number is 10 digits. */
export const isValidPran = (v: string) => /^\d{12}$/.test(v.trim());
export const isValidUan = (v: string) => /^\d{12}$/.test(v.trim());
export const isValidEsic = (v: string) => /^\d{10}$/.test(v.trim());
export const isValidPincode = (v: string) => /^[1-9]\d{5}$/.test(v.trim());
