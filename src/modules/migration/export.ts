import "server-only";
import JSZip from "jszip";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/session";
import { toCsv } from "@/lib/csv";
import { db } from "@/lib/db";
import { forbidden } from "@/lib/errors";
import { canCutOver } from "./staging";

/**
 * PRD §16 data ownership: everything the system holds, as one CSV and one JSON file per table, for the Board to keep
 * or to move to another system. Sign-in secrets (password hashes, sessions, OTPs) are never exported; Aadhaar, PAN and
 * bank numbers stay encrypted exactly as stored (the Board's key opens them). Only an Admin may take it, and it is logged.
 */
const SKIP = new Set(["Session", "OtpChallenge"]);
const OMIT: Record<string, string[]> = { User: ["passwordHash"] };
/** Tables keyed by more than one column are ordered by those columns. */
const ORDER: Record<string, object> = { Setting: [{ boardId: "asc" }, { key: "asc" }], Sequence: [{ boardId: "asc" }, { name: "asc" }] };

const cell = (v: unknown): string | number | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : typeof v === "bigint" ? v.toString() : (v as string | number);

export async function exportAllData(actor: Actor) {
  if (!canCutOver(actor)) throw forbidden();
  const zip = new JSZip();
  const counts: [string, number][] = [];
  for (const model of Object.values(Prisma.ModelName)) {
    if (SKIP.has(model)) continue;
    const delegate = (db as unknown as Record<string, { findMany(args: object): Promise<Record<string, unknown>[]> }>)[model[0].toLowerCase() + model.slice(1)];
    const rows: Record<string, unknown>[] = [];
    for (let skip = 0; ; skip += 5000) {
      const page = await delegate.findMany({ skip, take: 5000, orderBy: ORDER[model] ?? { id: "asc" } });
      rows.push(...page);
      if (page.length < 5000) break;
    }
    const omit = OMIT[model] ?? [];
    const clean = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !omit.includes(k))));
    const columns = clean.length ? Object.keys(clean[0]) : [];
    zip.file(`json/${model}.json`, JSON.stringify(clean, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
    zip.file(`csv/${model}.csv`, toCsv(columns, clean.map((r) => columns.map((c) => cell(r[c])))));
    counts.push([model, clean.length]);
  }
  const at = new Date().toISOString();
  zip.file(
    "README.txt",
    [
      "DCB HRMS & Payroll — full data export (PRD §16 data ownership)",
      `Taken ${at} by ${actor.name}`,
      "",
      "csv/  one file per table (UTF-8 with BOM, opens in Excel)",
      "json/ the same tables as JSON",
      "",
      "Not included: password hashes, sessions and one-time passwords.",
      "Aadhaar, PAN and bank account numbers are in the *Enc columns, encrypted (AES-256-GCM) with the Board's key.",
      "",
      "Rows per table:",
      ...counts.map(([m, n]) => `  ${m}: ${n}`),
    ].join("\r\n"),
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  await audit(db, actor, { action: "EXPORT", entityType: "Board", entityId: actor.boardId, summary: `Took the full data export (${counts.reduce((a, [, n]) => a + n, 0)} rows in ${counts.length} tables)`, sensitive: true });
  return { buffer, fileName: `DCB-HRMS-data-${at.slice(0, 10)}.zip` };
}
