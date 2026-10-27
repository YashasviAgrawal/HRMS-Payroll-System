import "server-only";
import ExcelJS from "exceljs";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { sha256 } from "@/lib/crypto";
import { parseCsv } from "@/lib/csv";
import { db, type DbLike } from "@/lib/db";
import { toISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { loadFile, saveFile } from "@/lib/storage";
import { readDbf, type DbfValue } from "./dbf";

/**
 * S-90, §15 steps 1–3: files from the old system are kept exactly as uploaded with their SHA-256 (copy and freeze), and
 * tables — FoxPro .DBF (with its .FPT memo file), CSV or Excel — are staged row by row, deleted rows kept apart.
 */

// ─── Who may do what (§14 "Migration (set-up only)") ─────────────────────────────

export const canSeeMigration = (actor: Actor) => canAll(actor, "migration", "view");
/** The User & settings manager may upload files; HR & Accounts upload, map, clean and load. */
export const canUploadMigration = (actor: Actor) => canAll(actor, "migration", "create");
export const canWorkMigration = (actor: Actor) => canAll(actor, "migration", "create") && actor.permissions.some((p) => p === "HR" || p === "PAYROLL" || p === "PENSION");
export const canCheckMigration = (actor: Actor) => canAll(actor, "migration", "check");
export const canCutOver = (actor: Actor) => canAll(actor, "migration", "approve");

export interface CutOver {
  date: string;
  byName: string;
  at: string;
}

/** §15 step 10: once the Admin signs the cut-over the console is read-only (set-up only). */
export async function cutOverOf(boardId: string, tx: DbLike = db): Promise<CutOver | null> {
  const row = await tx.setting.findUnique({ where: { boardId_key: { boardId, key: "migration.cutover" } } });
  return (row?.value as CutOver | null) ?? null;
}

export async function assertOpen(actor: Actor, tx: DbLike = db) {
  if (await cutOverOf(actor.boardId, tx)) throw conflict("migration.errors.cutOver");
}

// ─── Upload and staging ─────────────────────────────────────────────────────

const TABLE_EXT = new Set(["dbf", "csv", "xlsx"]);
const MEMO_EXT = new Set(["fpt", "dbt"]);
const MAX_FILE = 200 * 1024 * 1024;
const extOf = (name: string) => (name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "").toLowerCase();
const baseOf = (name: string) => name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").toUpperCase();

export type Cell = string | number | boolean | null;
interface Staged {
  columns: { name: string; type: string; length: number; decimals: number }[];
  sourceCount: number;
  rows: { rowNo: number; deleted: boolean; data: Record<string, Cell> }[];
  missingMemos: number;
}

function decodeText(buffer: Buffer) {
  // UTF-8 when the file is valid UTF-8 (a CSV saved from Excel), otherwise Windows-1252 as FoxPro wrote it.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

function fromHeaderAndRows(header: string[], body: Cell[][]): Staged {
  const names: string[] = [];
  header.forEach((h, i) => {
    let name = (h || `COLUMN${i + 1}`).trim().toUpperCase();
    while (names.includes(name)) name = `${name}_${i + 1}`;
    names.push(name);
  });
  const rows = body
    .filter((r) => r.some((c) => c !== null && c !== ""))
    .map((r, i) => ({ rowNo: i + 1, deleted: false, data: Object.fromEntries(names.map((n, j) => [n, r[j] === undefined || r[j] === "" ? null : r[j]])) as Record<string, Cell> }));
  return { columns: names.map((n) => ({ name: n, type: "C", length: 0, decimals: 0 })), sourceCount: rows.length, rows, missingMemos: 0 };
}

async function stage(ext: string, buffer: Buffer, memo?: Buffer): Promise<Staged> {
  if (ext === "dbf") {
    const t = readDbf(buffer, memo);
    return { columns: t.columns, sourceCount: t.count, rows: t.rows.map((r) => ({ rowNo: r.rowNo, deleted: r.deleted, data: r.values as Record<string, DbfValue> })), missingMemos: t.missingMemos };
  }
  if (ext === "csv") {
    const table = parseCsv(decodeText(buffer));
    if (!table.length) throw badRequest("migration.errors.empty");
    return fromHeaderAndRows(table[0], table.slice(1));
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest("migration.errors.empty");
  const grid: Cell[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const out: Cell[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const v = cell.value;
      out[col - 1] =
        v === null || v === undefined
          ? null
          : v instanceof Date
            ? toISODate(v)
            : typeof v === "object"
              ? "result" in v
                ? (v.result as Cell)
                : "text" in v
                  ? String(v.text)
                  : "richText" in v
                    ? v.richText.map((x) => x.text).join("")
                    : String(cell.text)
              : (v as Cell);
    });
    grid.push(out);
  });
  if (!grid.length) throw badRequest("migration.errors.empty");
  return fromHeaderAndRows(grid[0].map((h) => String(h ?? "")), grid.slice(1));
}

export interface UploadResult {
  fileName: string;
  kind: string;
  tableName: string | null;
  sourceCount: number | null;
  liveCount: number;
  deletedCount: number;
  missingMemos: number;
  error?: string;
  /** This exact file was already here. */
  already?: boolean;
}

/** Saves every file unchanged with its checksum and stages the tables in it. A memo file is read with its table. */
export async function uploadFiles(actor: Actor, files: File[]): Promise<UploadResult[]> {
  if (!canUploadMigration(actor)) throw forbidden();
  await assertOpen(actor);
  if (!files.length) throw badRequest("migration.errors.noFile");
  if (files.length > 30) throw badRequest("migration.errors.tooMany");
  const items = await Promise.all(files.map(async (f) => ({ name: f.name.replace(/^.*[\\/]/, ""), buffer: Buffer.from(await f.arrayBuffer()) })));
  for (const f of items) if (f.buffer.length > MAX_FILE) throw badRequest("migration.errors.tooBig");
  // Memo files first, so a table uploaded with its .FPT finds it; an earlier upload of the memo works too.
  items.sort((a, b) => Number(MEMO_EXT.has(extOf(b.name))) - Number(MEMO_EXT.has(extOf(a.name))));
  const memos = new Map<string, { id: string; buffer: Buffer }>();
  const results: UploadResult[] = [];
  for (const f of items) {
    const ext = extOf(f.name);
    const kind = ext === "dbf" ? "DBF" : ext === "csv" ? "CSV" : ext === "xlsx" ? "XLSX" : MEMO_EXT.has(ext) ? "MEMO" : "OTHER";
    // The very same file again (same name and checksum, still in use) is not kept twice.
    const same = await db.migrationFile.findFirst({ where: { boardId: actor.boardId, fileName: f.name, sha256: sha256(f.buffer), replaced: false } });
    if (same) {
      if (same.kind === "MEMO") memos.set(baseOf(f.name), { id: same.id, buffer: f.buffer });
      results.push({ fileName: f.name, kind: same.kind, tableName: same.tableName, sourceCount: same.sourceCount, liveCount: same.liveCount, deletedCount: same.deletedCount, missingMemos: same.missingMemos, already: true });
      continue;
    }
    const saved = await saveFile("migration", f.buffer, "bin");
    const base = { boardId: actor.boardId, fileName: f.name, kind, size: f.buffer.length, sha256: saved.sha256, storageKey: saved.key, uploadedById: actor.userId, uploadedByName: actor.name };
    if (!TABLE_EXT.has(ext)) {
      const rec = await db.migrationFile.create({ data: { ...base, tableName: MEMO_EXT.has(ext) ? baseOf(f.name) : null } });
      if (MEMO_EXT.has(ext)) memos.set(baseOf(f.name), { id: rec.id, buffer: f.buffer });
      await audit(db, actor, { action: "UPLOAD", entityType: "MigrationFile", entityId: rec.id, summary: `Kept ${f.name} from the old system (SHA-256 ${saved.sha256.slice(0, 12)}…)` });
      results.push({ fileName: f.name, kind, tableName: null, sourceCount: null, liveCount: 0, deletedCount: 0, missingMemos: 0 });
      continue;
    }
    const tableName = baseOf(f.name);
    let memo = memos.get(tableName);
    if (!memo && ext === "dbf") {
      const earlier = await db.migrationFile.findFirst({ where: { boardId: actor.boardId, kind: "MEMO", tableName }, orderBy: { createdAt: "desc" } });
      if (earlier) memo = { id: earlier.id, buffer: await loadFile(earlier.storageKey) };
    }
    let staged: Staged;
    try {
      staged = await stage(ext, f.buffer, memo?.buffer);
    } catch (e) {
      const rec = await db.migrationFile.create({ data: { ...base, kind: "OTHER", tableName } });
      await audit(db, actor, { action: "UPLOAD", entityType: "MigrationFile", entityId: rec.id, summary: `Kept ${f.name} (could not be read as a table: ${(e as Error).message})` });
      results.push({ fileName: f.name, kind: "OTHER", tableName, sourceCount: null, liveCount: 0, deletedCount: 0, missingMemos: 0, error: (e as Error).message });
      continue;
    }
    const deletedCount = staged.rows.filter((r) => r.deleted).length;
    const rec = await db.$transaction(
      async (tx) => {
        await tx.migrationFile.updateMany({ where: { boardId: actor.boardId, tableName, kind: { in: ["DBF", "CSV", "XLSX"] }, replaced: false }, data: { replaced: true } });
        const file = await tx.migrationFile.create({
          data: { ...base, tableName, sourceCount: staged.sourceCount, liveCount: staged.rows.length - deletedCount, deletedCount, columns: staged.columns, memoFileId: memo?.id ?? null, missingMemos: staged.missingMemos },
        });
        for (let i = 0; i < staged.rows.length; i += 1000) {
          await tx.migrationRow.createMany({ data: staged.rows.slice(i, i + 1000).map((r) => ({ fileId: file.id, rowNo: r.rowNo, deleted: r.deleted, data: r.data })) });
        }
        await audit(tx, actor, {
          action: "UPLOAD",
          entityType: "MigrationFile",
          entityId: file.id,
          summary: `Staged ${tableName}: ${staged.rows.length - deletedCount} rows, ${deletedCount} deleted kept apart (file says ${staged.sourceCount}; SHA-256 ${saved.sha256.slice(0, 12)}…)`,
        });
        return file;
      },
      { timeout: 300_000 },
    );
    results.push({ fileName: f.name, kind, tableName, sourceCount: rec.sourceCount, liveCount: rec.liveCount, deletedCount, missingMemos: staged.missingMemos });
  }
  return results;
}

/** Files received, newest first; the tables in use are the ones not replaced by a newer upload. */
export async function listFiles(actor: Actor) {
  if (!canSeeMigration(actor) && !canUploadMigration(actor)) throw forbidden();
  const files = await db.migrationFile.findMany({ where: { boardId: actor.boardId }, orderBy: { createdAt: "desc" } });
  return files.map((f) => ({ ...f, columns: (f.columns as Staged["columns"] | null) ?? [], createdAt: f.createdAt.toISOString() }));
}

/** The staged tables in use (one per table name). */
export async function stagedTables(boardId: string) {
  return db.migrationFile.findMany({ where: { boardId, kind: { in: ["DBF", "CSV", "XLSX"] }, replaced: false }, orderBy: { tableName: "asc" } });
}

/** A page of a staged table, for looking at it before mapping (deleted rows only when asked). */
export async function tableRows(actor: Actor, fileId: string, opts: { page?: number; deleted?: boolean; q?: string } = {}) {
  if (!canSeeMigration(actor)) throw forbidden();
  const file = await db.migrationFile.findFirst({ where: { id: fileId, boardId: actor.boardId } });
  if (!file) throw notFound();
  const size = 50;
  const page = Math.max(1, opts.page ?? 1);
  const where = { fileId, deleted: Boolean(opts.deleted) };
  const [rows, total] = await Promise.all([db.migrationRow.findMany({ where, orderBy: { rowNo: "asc" }, skip: (page - 1) * size, take: size }), db.migrationRow.count({ where })]);
  return { file: { ...file, columns: (file.columns as Staged["columns"] | null) ?? [] }, rows: rows.map((r) => ({ id: r.id, rowNo: r.rowNo, deleted: r.deleted, data: r.data as Record<string, Cell>, fixed: (r.fixed as Record<string, Cell> | null) ?? {} })), total, page, pages: Math.max(1, Math.ceil(total / size)) };
}

/** The frozen copy, byte for byte, for audit (the checksum is checked on the way out). */
export async function frozenFile(actor: Actor, fileId: string) {
  if (!canSeeMigration(actor)) throw forbidden();
  const file = await db.migrationFile.findFirst({ where: { id: fileId, boardId: actor.boardId } });
  if (!file) throw notFound();
  const buffer = await loadFile(file.storageKey);
  if (sha256(buffer) !== file.sha256) throw conflict("migration.errors.checksum");
  await audit(db, actor, { action: "DOWNLOAD", entityType: "MigrationFile", entityId: file.id, summary: `Downloaded the frozen copy of ${file.fileName}` });
  return { buffer, fileName: file.fileName };
}
