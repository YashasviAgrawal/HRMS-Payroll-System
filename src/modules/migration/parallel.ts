import "server-only";
import { z } from "zod";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isMonth, shiftMonth } from "@/lib/dates";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { fromPaise, toPaise } from "@/lib/money";
import type { PayLine } from "@/modules/payroll/engine";
import { fullName } from "@/modules/employees/present";
import { mappingOf } from "./build";
import { canMapTarget } from "./mapping";
import { assertOpen, canSeeMigration } from "./staging";
import { cellOf, keepRow, parseAmount, type Codes, type Fields, type Options } from "./targets";

/**
 * §15 step 9: three months in both systems. Each month FoxPro's pay sheet (one row per person and head, or one column
 * per head) is compared with this system's regular bills for the month; every difference over ₹1 is listed per
 * employee per head and explained before the next month. Three matched months in a row allow the cut-over.
 */
export const MISSING_HERE = "NOT_PAID_HERE";
export const MISSING_THERE = "NOT_IN_FOXPRO";

type Amounts = Map<string, Map<string, number>>;
const add = (m: Amounts, code: string, head: string, amount: number) => {
  const p = m.get(code) ?? new Map<string, number>();
  p.set(head, fromPaise(toPaise(p.get(head) ?? 0) + toPaise(amount)));
  m.set(code, p);
};

/** FoxPro's figures by employee code and pay head, read through the parallel-run mapping. */
async function foxproSheet(boardId: string, fileId: string) {
  const mapping = await mappingOf(boardId, "parallel");
  if (!mapping) throw badRequest("migration.errors.notMapped");
  const fields = (mapping.fields ?? {}) as unknown as Fields;
  const codes = (mapping.codes ?? {}) as unknown as Codes;
  const options = (mapping.options ?? {}) as unknown as Options;
  if (!fields.employeeCode?.column) throw badRequest("migration.errors.notMapped");
  const rows = await db.migrationRow.findMany({ where: { fileId, deleted: false }, orderBy: { rowNo: "asc" } });
  const heads = codes.head ?? {};
  const out: Amounts = new Map();
  for (const r of rows) {
    const row = { data: r.data as Record<string, string | number | null>, fixed: r.fixed as Record<string, string | number | null> | null };
    if (!keepRow(row, options)) continue;
    const code = String(cellOf(row, fields.employeeCode.column) ?? "").trim().toUpperCase();
    if (!code) continue;
    if (options.layout === "wide") {
      // One column per FoxPro pay code; the code list says which head each column is.
      for (const [column, head] of Object.entries(heads)) {
        const v = parseAmount(cellOf(row, column) as string | number | null);
        if (typeof v === "number" && v !== 0) add(out, code, head, v);
      }
    } else {
      if (!fields.head?.column || !fields.amount?.column) throw badRequest("migration.errors.notMapped");
      const foxCode = String(cellOf(row, fields.head.column) ?? "").trim();
      const head = heads[foxCode] ?? heads[foxCode.toUpperCase()];
      const v = parseAmount(cellOf(row, fields.amount.column) as string | number | null);
      if (!head || typeof v !== "number") continue;
      add(out, code, head, v);
    }
  }
  return out;
}

/** Compares one month and keeps what was already explained for a difference that is still the same. */
export async function runParallel(actor: Actor, raw: unknown) {
  if (!canMapTarget(actor, "parallel")) throw forbidden();
  await assertOpen(actor);
  const input = z.object({ month: z.string().refine(isMonth, "validation.invalid"), fileId: z.string().min(1) }).parse(raw);
  const file = await db.migrationFile.findFirst({ where: { id: input.fileId, boardId: actor.boardId, kind: { in: ["DBF", "CSV", "XLSX"] } } });
  if (!file) throw notFound();
  const fox = await foxproSheet(actor.boardId, file.id);
  const slips = await db.payslip.findMany({
    where: { boardId: actor.boardId, month: input.month, pensionerId: null, run: { kind: "REGULAR", payGroup: { not: "PENSION" } } },
    select: { lines: true, employee: { select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true } } },
  });
  if (!slips.length) throw badRequest("migration.errors.noBill");
  const ours: Amounts = new Map();
  const people = new Map<string, { id: string; name: string }>();
  for (const s of slips) {
    const code = (s.employee.employeeCode ?? "").toUpperCase();
    people.set(code, { id: s.employee.id, name: fullName(s.employee) });
    for (const l of s.lines as unknown as PayLine[]) if (l.amount) add(ours, code, l.code, l.amount);
  }
  const extra = await db.employee.findMany({ where: { boardId: actor.boardId, employeeCode: { in: [...fox.keys()].filter((c) => !people.has(c)) } }, select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true } });
  for (const e of extra) people.set(e.employeeCode!.toUpperCase(), { id: e.id, name: fullName(e) });

  const diffs: { employeeCode: string; employeeId: string | null; name: string | null; head: string; fox: number; ours: number }[] = [];
  const codes = new Set([...fox.keys(), ...ours.keys()]);
  let matched = 0;
  const headsSeen = new Set<string>();
  for (const code of codes) {
    const f = fox.get(code);
    const o = ours.get(code);
    const who = people.get(code);
    const before = diffs.length;
    const sum = (m?: Map<string, number>) => fromPaise([...(m?.values() ?? [])].reduce((a, v) => a + toPaise(v), 0));
    if (!o) diffs.push({ employeeCode: code, employeeId: who?.id ?? null, name: who?.name ?? null, head: MISSING_HERE, fox: sum(f), ours: 0 });
    else if (!f) diffs.push({ employeeCode: code, employeeId: who?.id ?? null, name: who?.name ?? null, head: MISSING_THERE, fox: 0, ours: sum(o) });
    else {
      for (const head of new Set([...f.keys(), ...o.keys()])) {
        headsSeen.add(head);
        const a = f.get(head) ?? 0;
        const b = o.get(head) ?? 0;
        if (Math.abs(toPaise(a) - toPaise(b)) > 100) diffs.push({ employeeCode: code, employeeId: who?.id ?? null, name: who?.name ?? null, head, fox: a, ours: b });
      }
    }
    if (diffs.length === before) matched++;
  }

  return db.$transaction(async (tx) => {
    const old = await tx.parallelRun.findUnique({ where: { boardId_month: { boardId: actor.boardId, month: input.month } }, include: { diffs: true } });
    const notes = new Map((old?.diffs ?? []).filter((d) => d.note).map((d) => [`${d.employeeCode}|${d.head}|${Number(d.fox)}|${Number(d.ours)}`, d]));
    if (old) await tx.parallelRun.delete({ where: { id: old.id } });
    const run = await tx.parallelRun.create({ data: { boardId: actor.boardId, month: input.month, fileId: file.id, people: codes.size, heads: headsSeen.size, matched, createdById: actor.userId, createdByName: actor.name } });
    if (diffs.length) {
      await tx.parallelDiff.createMany({
        data: diffs.map((d) => {
          const n = notes.get(`${d.employeeCode}|${d.head}|${d.fox}|${d.ours}`);
          return { runId: run.id, ...d, note: n?.note ?? null, explainedById: n?.explainedById ?? null, explainedByName: n?.explainedByName ?? null, explainedAt: n?.explainedAt ?? null };
        }),
      });
    }
    await audit(tx, actor, { action: "CREATE", entityType: "ParallelRun", entityId: run.id, summary: `Parallel run ${input.month}: ${codes.size} people, ${matched} matched to ₹1, ${diffs.length} differences (FoxPro file ${file.tableName})` });
    return { id: run.id, people: codes.size, matched, diffs: diffs.length };
  });
}

/** A difference explained in writing (§15 step 9). */
export async function explainDiff(actor: Actor, diffId: string, raw: unknown) {
  if (!canMapTarget(actor, "parallel")) throw forbidden();
  await assertOpen(actor);
  const { note } = z.object({ note: z.string().trim().min(5, "validation.tooShort").max(500) }).parse(raw);
  const d = await db.parallelDiff.findFirst({ where: { id: diffId, run: { boardId: actor.boardId } }, include: { run: true } });
  if (!d) throw notFound();
  await db.$transaction(async (tx) => {
    await tx.parallelDiff.update({ where: { id: d.id }, data: { note, explainedById: actor.userId, explainedByName: actor.name, explainedAt: new Date() } });
    await audit(tx, actor, { action: "EXPLAIN", entityType: "ParallelDiff", entityId: d.id, summary: `Explained the ${d.run.month} difference for ${d.employeeCode} ${d.head}: ${note}` });
  });
  return { ok: true };
}

/** Months compared, newest first, and the run of fully explained months that ends with the latest one. */
export async function parallelScreen(actor: Actor, monthParam?: string) {
  if (!canSeeMigration(actor)) throw forbidden();
  const runs = await db.parallelRun.findMany({ where: { boardId: actor.boardId }, orderBy: { month: "desc" }, include: { diffs: { select: { id: true, note: true } } } });
  const months = runs.map((r) => ({ id: r.id, month: r.month, people: r.people, matched: r.matched, diffs: r.diffs.length, explained: r.diffs.filter((d) => d.note).length, ok: r.diffs.every((d) => d.note), at: r.createdAt.toISOString(), byName: r.createdByName }));
  let streak = 0;
  for (let i = 0; i < months.length; i++) {
    if (!months[i].ok || (i > 0 && months[i].month !== shiftMonth(months[i - 1].month, -1))) break;
    streak++;
  }
  const open = monthParam ? runs.find((r) => r.month === monthParam) : runs[0];
  const diffs = open ? await db.parallelDiff.findMany({ where: { runId: open.id }, orderBy: [{ employeeCode: "asc" }, { head: "asc" }] }) : [];
  return {
    months,
    streak,
    open: open ? { month: open.month, diffs: diffs.map((d) => ({ id: d.id, employeeCode: d.employeeCode, employeeId: d.employeeId, name: d.name, head: d.head, fox: Number(d.fox), ours: Number(d.ours), note: d.note, explainedByName: d.explainedByName })) } : null,
    canRun: canMapTarget(actor, "parallel"),
  };
}
