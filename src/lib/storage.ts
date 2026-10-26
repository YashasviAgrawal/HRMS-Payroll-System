import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomToken, sha256 } from "./crypto";
import { env } from "./env";

/**
 * File storage for uploaded documents and generated files. Keys are always generated here
 * ("<area>/<yyyy>/<mm>/<random>.<ext>"), so a key can never point outside the storage folder.
 */
export type FileKind = "pdf" | "png" | "jpg" | "xlsx" | "csv" | "txt" | "zip";

const MIME: Record<FileKind, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
};

export const mimeOf = (kind: FileKind) => MIME[kind];

/** Recognises a file by its first bytes, not by its name (a renamed .exe is not a PDF). */
export function sniff(buffer: Buffer): FileKind | null {
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return "xlsx";
  return null;
}

const KEY_RE = /^[a-z-]+\/\d{4}\/\d{2}\/[A-Za-z0-9_-]+\.[a-z0-9]+$/;

function root() {
  return path.resolve(env().STORAGE_DIR);
}

export async function saveFile(area: string, buffer: Buffer, ext: FileKind) {
  const now = new Date();
  const key = `${area}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomToken(18)}.${ext}`;
  const full = path.join(root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buffer, { mode: 0o640 });
  return { key, sha256: sha256(buffer), size: buffer.length };
}

export async function loadFile(key: string): Promise<Buffer> {
  if (!KEY_RE.test(key)) throw new Error("Bad storage key");
  return readFile(path.join(root(), key));
}
