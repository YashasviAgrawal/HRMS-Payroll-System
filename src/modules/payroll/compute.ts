/**
 * Working out a payroll from the records (PRD §8) — the database reads and the save, shared by the payroll run
 * (S-40) and the demo seed. No "server-only" here: the seed runs outside Next.js, so every function takes the
 * database client it should use.
 */
import type { EmployeeType, PayGroup } from "@/generated/prisma/enums";
import type { PayHead, Prisma } from "@/generated/prisma/client";
import type { DbLike, Tx } from "@/lib/db";
import { datesOfMonth, daysBetweenInclusive, endOfMonth, formatMonth, fromISODate, maxDate, shiftMonth, toISODate, type ISODate } from "@/lib/dates";
import { badRequest, conflict } from "@/lib/errors";
import { changePct, EXCEPTION_RULES, exceptionKey, preChecks, type Found } from "./checks";
import { computePay, TYPES_IN_GROUP, type HeadRule, type PayInput, type PayLine } from "./engine";

// ─── Reading ──────────────────────────────────────────────────────────────────

/** The rates in force on a date: for each key, the latest row on or before it. */
export async function ratesOn(boardId: string, date: ISODate, tx: DbLike): Promise<Record<string, number>> {
  const rows = await tx.payRate.findMany({ where: { boardId, effectiveFrom: { lte: fromISODate(date) } }, orderBy: { effectiveFrom: "asc" } });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key] = Number(r.value);
  return out;
}

/** The pay matrix in force on a date (PR-01). */
export async function matrixOn(boardId: string, date: ISODate, tx: DbLike) {
  const m = await tx.payMatrix.findFirst({ where: { boardId, effectiveFrom: { lte: fromISODate(date) } }, orderBy: { effectiveFrom: "desc" } });
  return m ? { ...m, levels: m.levels as Record<string, number[]> } : null;
}

export function basicFrom(levels: Record<string, number[]> | null | undefined, level: string | null, cell: number | null): number | null {
  if (!levels || !level || !cell) return null;
  return levels[level]?.[cell - 1] ?? null;
}

export function toHeadRule(h: PayHead): HeadRule {
  return { code: h.code, name: h.name, nameHi: h.nameHi, kind: h.kind, calc: h.calc, value: Number(h.value), postCodes: h.postCodes, prorate: h.prorate, countsForDa: h.countsForDa, accountHead: h.accountHead };
}

export async function payHeads(boardId: string, tx: DbLike) {
  return tx.payHead.findMany({ where: { boardId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
}

/** Standing pay items in force in a month, by employee and head. */
export async function itemsFor(boardId: string, month: string, employeeIds: string[], tx: DbLike) {
  const rows = await tx.employeePayItem.findMany({ where: { boardId, employeeId: { in: employeeIds }, fromMonth: { lte: month }, OR: [{ toMonth: null }, { toMonth: { gte: month } }] } });
  const out = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const m = out.get(r.employeeId) ?? {};
    m[r.headCode] = (m[r.headCode] ?? 0) + Number(r.amount);
    out.set(r.employeeId, m);
  }
  return out;
}

/** Pay groups run here; pensioners get their own payroll in Module 9. */
export const RUN_GROUPS = ["OPS", "NPS", "CONTRACT"] as const;
export type RunGroup = (typeof RUN_GROUPS)[number];

const MATRIX_TYPES: EmployeeType[] = ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION"];

const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const groupLabel: Record<RunGroup, string> = { OPS: "Permanent – OPS", NPS: "Permanent – NPS", CONTRACT: "Contract and daily wage" };
const groupLabelHi: Record<RunGroup, string> = { OPS: "स्थायी – ओपीएस", NPS: "स्थायी – एनपीएस", CONTRACT: "संविदा और दैनिक वेतन" };
export const runTitle = (group: RunGroup, month: string, lang: "en" | "hi" = "en") =>
  lang === "hi" ? `वेतन ${formatMonth(month, "hi")} — ${groupLabelHi[group]}` : `Payroll ${formatMonth(month)} — ${groupLabel[group]}`;

// ─── Working out the pay ──────────────────────────────────────────────────────

export interface ComputedSlip {
  employeeId: string;
  sectionId: string;
  postId: string;
  payLevel: string | null;
  payCell: number | null;
  daysInMonth: number;
  daysOnRoll: number;
  lossDays: number;
  halfPayDays: number;
  workedDays: number | null;
  lines: PayLine[];
  gross: number;
  deductions: number;
  net: number;
  employer: number;
  bankLast4: string | null;
  ifsc: string | null;
  lastNet: number | null;
  changePct: number | null;
}

/**
 * Works out a pay group's month from the records as they stand: matrix and rates in force on the 1st, pay heads,
 * standing items, last month's locked attendance (D-17) and the bank details. Pure reading — nothing is saved.
 * `ignoreAttendance` (with `assumeWorkedDays` for daily wages) is for the demo history only.
 */
export async function computeRun(tx: DbLike, boardId: string, group: RunGroup, month: string, opts: { ignoreAttendance?: boolean; assumeWorkedDays?: number } = {}) {
  const monthStart = `${month}-01`;
  const monthEnd = endOfMonth(monthStart);
  const dim = datesOfMonth(month).length;
  const last = shiftMonth(month, -1);
  const [employees, rates, matrix, headRows, sections] = await Promise.all([
    tx.employee.findMany({
      where: {
        boardId,
        type: { in: TYPES_IN_GROUP[group] },
        status: { not: "DRAFT" },
        dateOfJoining: { lte: fromISODate(monthEnd) },
        OR: [{ status: { in: ["ACTIVE", "SUSPENDED"] } }, { exitDate: { gte: fromISODate(monthStart) } }],
      },
      include: { post: true },
      orderBy: { employeeCode: "asc" },
    }),
    ratesOn(boardId, monthStart, tx),
    matrixOn(boardId, monthStart, tx),
    payHeads(boardId, tx),
    tx.section.findMany({ where: { boardId }, select: { id: true, name: true, nameHi: true } }),
  ]);
  const ids = employees.map((e) => e.id);
  const [items, locks, attMonths, lastSlips, holders] = await Promise.all([
    itemsFor(boardId, month, ids, tx),
    tx.attendanceLock.findMany({ where: { boardId, month: last, unlockedAt: null }, select: { sectionId: true } }),
    tx.attendanceMonth.findMany({ where: { employeeId: { in: ids }, month: last } }),
    // Last month's pay as approved — a draft that never went out is not "last month".
    tx.payslip.findMany({ where: { employeeId: { in: ids }, month: last, status: "INCLUDED", run: { status: { in: ["APPROVED", "PAID", "CLOSED"] } } }, select: { employeeId: true, net: true }, orderBy: { createdAt: "asc" } }),
    tx.employee.groupBy({ by: ["bankAccountHash"], where: { boardId, bankAccountHash: { not: null }, status: { in: ["ACTIVE", "SUSPENDED"] } }, _count: { _all: true } }),
  ]);
  if (!matrix && employees.some((e) => MATRIX_TYPES.includes(e.type))) throw badRequest("payroll.errors.noMatrix");
  const heads = headRows.filter((h) => h.isActive).map(toHeadRule);
  const locked = new Set(locks.map((l) => l.sectionId));
  const attBy = new Map(attMonths.map((a) => [a.employeeId, a]));
  const lastNetBy = new Map(lastSlips.map((s) => [s.employeeId, num(s.net)]));
  const bankHolders = new Map(holders.map((h) => [h.bankAccountHash!, h._count._all]));
  const sectionBy = new Map(sections.map((s) => [s.id, s]));

  const slips: ComputedSlip[] = [];
  const facts: Parameters<typeof preChecks>[0] = [];
  const notLocked = new Map<string, string[]>();
  for (const e of employees) {
    const doj = toISODate(e.dateOfJoining);
    const isMatrix = MATRIX_TYPES.includes(e.type);
    // Last day on the rolls: the exit date, else retirement (staff) or contract end (contract and re-employed).
    const endBy = e.exitDate ? toISODate(e.exitDate) : isMatrix ? (e.dateOfRetirement ? toISODate(e.dateOfRetirement) : null) : e.contractEnd ? toISODate(e.contractEnd) : null;
    const afterRetirement = !e.exitDate && endBy !== null && endBy < monthStart;
    const rollEnd = endBy && !afterRetirement && endBy < monthEnd ? endBy : monthEnd;
    const rollStart = maxDate(doj, monthStart);
    const daysOnRoll = rollEnd >= rollStart ? daysBetweenInclusive(rollStart, rollEnd) : 0;

    let lastAtt: PayInput["last"] = null;
    if (doj < monthStart && opts.ignoreAttendance && opts.assumeWorkedDays) {
      lastAtt = { daysInMonth: datesOfMonth(last).length, lossDays: 0, halfPayDays: 0, workedDays: opts.assumeWorkedDays };
    } else if (doj < monthStart && !opts.ignoreAttendance) {
      const am = attBy.get(e.id);
      if (am && locked.has(am.sectionId)) {
        lastAtt = { daysInMonth: am.daysInMonth, lossDays: num(am.diesNon) + num(am.noPayLeave), halfPayDays: num(am.halfPayLeave), workedDays: num(am.workedDays) };
      } else if (!locked.has(e.sectionId)) {
        notLocked.set(e.sectionId, [...(notLocked.get(e.sectionId) ?? []), e.id]);
      }
    }
    const basic = isMatrix ? basicFrom(matrix?.levels, e.payLevel, e.payCell) : null;
    const noPayLevel = isMatrix ? basic === null : e.wageRate === null;
    const result = computePay({
      type: e.type,
      postCode: e.post.code,
      group: e.post.group,
      payLevel: e.payLevel,
      basic,
      wageRate: e.wageRate === null ? null : num(e.wageRate),
      wageBasis: e.wageBasis,
      daysInMonth: dim,
      daysOnRoll,
      last: lastAtt,
      rates,
      heads,
      items: items.get(e.id) ?? {},
    });
    const lastNet = lastNetBy.get(e.id) ?? null;
    const pct = changePct(result.net, lastNet);
    slips.push({
      employeeId: e.id,
      sectionId: e.sectionId,
      postId: e.postId,
      payLevel: e.payLevel,
      payCell: e.payCell,
      daysInMonth: dim,
      daysOnRoll,
      lossDays: lastAtt?.lossDays ?? 0,
      halfPayDays: lastAtt?.halfPayDays ?? 0,
      workedDays: lastAtt ? lastAtt.workedDays : null,
      ...result,
      bankLast4: e.bankAccountLast4,
      ifsc: e.ifsc,
      lastNet,
      changePct: pct,
    });
    facts.push({ employeeId: e.id, net: result.net, lastNet, hasBank: Boolean(e.bankAccountHash && e.ifsc), bankHash: e.bankAccountHash, afterRetirement, noPayLevel, suspended: e.status === "SUSPENDED" });
  }
  const found: Found[] = preChecks(facts, bankHolders);
  for (const [sectionId, people] of notLocked) {
    const s = sectionBy.get(sectionId);
    found.push({ employeeId: null, code: "ATTENDANCE_NOT_LOCKED", vars: { sectionId, section: s?.name ?? "", sectionHi: s?.nameHi ?? "", people: people.length, month: last, employeeIds: people.join(",") } });
  }
  return { slips, found, rates, matrixName: matrix?.name ?? null };
}

/** Sets each slip in or out of the bill from the resolutions, then the run's totals. */
export async function applyResolutions(tx: Tx, runId: string) {
  const exceptions = await tx.payrollException.findMany({ where: { runId, resolution: "WITHHELD" } });
  const withheld = new Map<string, string[]>();
  for (const x of exceptions) {
    const people = x.employeeId ? [x.employeeId] : String((x.vars as Record<string, unknown> | null)?.employeeIds ?? "").split(",").filter(Boolean);
    for (const id of people) withheld.set(id, [...(withheld.get(id) ?? []), x.code]);
  }
  await tx.payslip.updateMany({ where: { runId }, data: { status: "INCLUDED", withheldReason: null } });
  for (const [employeeId, codes] of withheld) {
    await tx.payslip.updateMany({ where: { runId, employeeId }, data: { status: "WITHHELD", withheldReason: codes.join(",") } });
  }
  const sum = await tx.payslip.aggregate({ where: { runId, status: "INCLUDED" }, _sum: { gross: true, deductions: true, net: true, employer: true }, _count: { _all: true } });
  await tx.payrollRun.update({
    where: { id: runId },
    data: { employees: sum._count._all, gross: num(sum._sum.gross), deductions: num(sum._sum.deductions), net: num(sum._sum.net), employer: num(sum._sum.employer) },
  });
}

/** Saves a worked-out run, carrying over resolutions that still apply. Used by the run and by the demo seed. */
export async function saveRun(tx: Tx, who: { boardId: string; userId: string; name: string }, group: RunGroup, month: string, computed: Awaited<ReturnType<typeof computeRun>>) {
  const existing = await tx.payrollRun.findUnique({ where: { boardId_payGroup_month: { boardId: who.boardId, payGroup: group, month } } });
  if (existing && existing.status !== "DRAFT") throw conflict("payroll.errors.notDraft");
  const old = existing ? await tx.payrollException.findMany({ where: { runId: existing.id, resolution: { not: null } } }) : [];
  const oldBy = new Map(old.map((x) => [exceptionKey(x), x]));
  const run = existing
    ? await tx.payrollRun.update({ where: { id: existing.id }, data: { version: { increment: 1 }, runById: who.userId, runByName: who.name, runAt: new Date() } })
    : await tx.payrollRun.create({ data: { boardId: who.boardId, payGroup: group, month, runById: who.userId, runByName: who.name, runAt: new Date() } });
  if (existing) {
    await tx.payslip.deleteMany({ where: { runId: run.id } });
    await tx.payrollException.deleteMany({ where: { runId: run.id } });
  }
  await tx.payslip.createMany({
    data: computed.slips.map((s) => ({
      boardId: who.boardId,
      runId: run.id,
      month,
      payGroup: group as PayGroup,
      ...s,
      lines: s.lines as unknown as Prisma.InputJsonValue,
    })),
  });
  await tx.payrollException.createMany({
    data: computed.found.map((f) => {
      const prev = oldBy.get(exceptionKey(f));
      const keep = prev && prev.resolution && EXCEPTION_RULES[f.code].resolutions.includes(prev.resolution);
      return {
        runId: run.id,
        employeeId: f.employeeId,
        code: f.code,
        severity: EXCEPTION_RULES[f.code].severity,
        vars: f.vars,
        ...(keep ? { resolution: prev.resolution, note: prev.note, resolvedById: prev.resolvedById, resolvedByName: prev.resolvedByName, resolvedAt: prev.resolvedAt } : {}),
      };
    }),
  });
  await applyResolutions(tx, run.id);
  return run;
}


/** Pay levels in matrix order: 1, 2 … 13, 13A, 14 … (JSON objects come back in key order, not matrix order). */
export function levelOrder(a: string, b: string): number {
  return parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b);
}
