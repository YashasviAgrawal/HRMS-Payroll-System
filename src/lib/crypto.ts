import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Field-level encryption for Aadhaar, PAN and bank account numbers (EM-03, PRD §16 security).
 * Format: "v1.<iv>.<tag>.<ciphertext>" (base64url). The version prefix allows key rotation later.
 */
const VERSION = "v1";

function key(name: "DATA_ENCRYPTION_KEY" | "BLIND_INDEX_KEY" | "OTP_PEPPER") {
  return Buffer.from(env()[name], "base64");
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("DATA_ENCRYPTION_KEY"), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(token: string): string {
  const [version, iv, tag, data] = token.split(".");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Unreadable encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key("DATA_ENCRYPTION_KEY"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * Keyed hash used to find duplicates (same Aadhaar / PAN / bank account) without decrypting anything.
 * The value is normalised first so "abcde1234f" and "ABCDE1234F" collide as they should.
 */
export function blindIndex(kind: string, value: string): string {
  const normalised = value.replace(/[\s-]/g, "").toUpperCase();
  return createHmac("sha256", key("BLIND_INDEX_KEY")).update(`${kind}:${normalised}`).digest("hex");
}

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
