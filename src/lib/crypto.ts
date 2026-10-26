import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { blindIndexWith, decryptWith, encryptWith, sealWith, type SensitiveKind } from "./crypto-core";
import { env } from "./env";

/**
 * Field-level encryption for Aadhaar, PAN and bank account numbers (EM-03, PRD §16 security).
 * Format: "v1.<iv>.<tag>.<ciphertext>" (base64url). The version prefix allows key rotation later.
 */
function key(name: "DATA_ENCRYPTION_KEY" | "BLIND_INDEX_KEY" | "OTP_PEPPER") {
  return Buffer.from(env()[name], "base64");
}

export const encrypt = (plain: string) => encryptWith(key("DATA_ENCRYPTION_KEY"), plain);
export const decrypt = (token: string) => decryptWith(key("DATA_ENCRYPTION_KEY"), token);

/**
 * Keyed hash used to find duplicates (same Aadhaar / PAN / bank account) without decrypting anything.
 * The value is normalised first so "abcde1234f" and "ABCDE1234F" collide as they should.
 */
export const blindIndex = (kind: string, value: string) => blindIndexWith(key("BLIND_INDEX_KEY"), kind, value);

/** { enc, hash, last4 } ready to store for a sensitive identifier. */
export const seal = (kind: SensitiveKind, value: string) => sealWith(key("DATA_ENCRYPTION_KEY"), key("BLIND_INDEX_KEY"), kind, value);

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** OTP hashes are peppered so a database leak alone does not reveal live codes. */
export function hashOtp(challengeId: string, code: string): string {
  return createHmac("sha256", key("OTP_PEPPER")).update(`${challengeId}:${code}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function randomDigits(length: number): string {
  // Rejection sampling keeps every digit equally likely.
  let out = "";
  while (out.length < length) {
    const byte = randomBytes(1)[0];
    if (byte < 250) out += String(byte % 10);
  }
  return out;
}
