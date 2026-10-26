import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Field encryption primitives with explicit keys, so scripts (seed, migration tools) can use the same
 * format as the app. The app itself goes through lib/crypto.ts, which supplies the keys from configuration.
 */
const VERSION = "v1";

export function encryptWith(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptWith(key: Buffer, token: string): string {
  const [version, iv, tag, data] = token.split(".");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Unreadable encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function normaliseIdentifier(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function blindIndexWith(key: Buffer, kind: string, value: string): string {
  return createHmac("sha256", key).update(`${kind}:${normaliseIdentifier(value)}`).digest("hex");
}

export type SensitiveKind = "pan" | "aadhaar" | "bank";

/** Encrypted value + duplicate-finding hash + last four characters for display. */
export function sealWith(encKey: Buffer, indexKey: Buffer, kind: SensitiveKind, value: string) {
  const clean = normaliseIdentifier(value);
  return { enc: encryptWith(encKey, clean), hash: blindIndexWith(indexKey, kind, clean), last4: clean.slice(-4) };
}
