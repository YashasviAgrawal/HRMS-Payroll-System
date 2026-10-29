/**
 * Working out a payroll from the records (PRD §8) — the database reads and the save, shared by the payroll run
 * (S-40) and the demo seed. No "server-only" here: the seed runs outside Next.js, so every function takes the
 * database client it should use.
 */
import type { EmployeeType, PayGroup } from "@/generated/prisma/enums";
import type { PayHead, Prisma } from "@/generated/prisma/client";
import type { DbLike, Tx } from "@/lib/db";
import { datesOfMonth, daysBetweenInclusive, endOfMonth, formatMonth, fromISODate, maxDate, shiftMonth, todayIST, toISODate, type ISODate } from "@/lib/dates";
import { badRequest, conflict } from "@/lib/errors";
import { changePct, EXCEPTION_RULES, exceptionKey, preChecks, type Found } from "./checks";
import { gpfRefundsDue } from "@/modules/statutory/gpf-posting";
import { statutorySettings } from "@/modules/statutory/settings";
import { professionalTaxFor } from "@/modules/statutory/tax-rules";
import { headFlags, monthsStillToCome, partsOf, projectTds, taxContext } from "@/modules/statutory/tds-projection";
import { computePensionRun } from "@/modules/pension/compute";
import { computePay, TYPES_IN_GROUP, type HeadRule, type PayInput, type PayLine } from "./engine";
import { fromPaise, toPaise } from "@/lib/money";
import { loanPosition, loanTermsOf } from "./loan-rules";
import { basicIn, seventhCpcMatrix, type MatrixLevels } from "./matrix-7cpc";

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
  return basicIn(levels, level, cell);
}

/**
 * The levels of the matrix in force on a date for screens and letters: the dated one, or the built-in
 * 7th CPC table before any matrix has been stored.
 */
export async function matrixLevelsOn(boardId: string, date: ISODate, tx: DbLike): Promise<MatrixLevels> {
  return (await matrixOn(boardId, date, tx))?.levels ?? seventhCpcMatrix();
}

/** The matrix the screens show today (employee records, recruitment). */
export const matrixToday = (boardId: string, tx: DbLike) => matrixLevelsOn(boardId, todayIST(), tx);

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

/** Staff pay groups (S-40). Pensioners are a pay group of their own, run through the same stages (S-61, PN-02). */
export const RUN_GROUPS = ["OPS", "NPS", "CONTRACT"] as const;
export const PAY_GROUPS = [...RUN_GROUPS, "PENSION"] as const;
export type StaffGroup = (typeof RUN_GROUPS)[number];
export type RunGroup = (typeof PAY_GROUPS)[number];
/** Salaries are Payroll's (§14 payroll); pension bills are Pension's (§14 pension) — the stages are the same. */
export const fnOf = (group: string): "payroll" | "pension" => (group === "PENSION" ? "pension" : "payroll");

const MATRIX_TYPES: EmployeeType[] = ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION"];

const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const groupLabel: Record<RunGroup, string> = { OPS: "Permanent – OPS", NPS: "Permanent – NPS", CONTRACT: "Contract and daily wage", PENSION: "Pensioners" };
const groupLabelHi: Record<RunGroup, string> = { OPS: "स्थायी – ओपीएस", NPS: "स्थायी – एनपीएस", CONTRACT: "संविदा और दैनिक वेतन", PENSION: "पेंशनभोगी" };
export type SupplementarySource =
  | { type: "ARREARS"; employeeIds: string[]; fromMonth: string; toMonth: string; reason: string; pensionerIds?: string[] }
  | { type: "BENEFITS"; caseId: string; name: string }
  | { type: "WITHHELD"; payslipIds: string[] }
  | { type: "JOINER"; employeeIds: string[]; forMonth: string }
  | { type: "SETTLEMENT"; separationId: string; name: string };

/** The name of a bill: "Payroll October 2026 — Permanent – NPS", or for a supplementary bill what it pays. */
export function titleOf(run: { payGroup: string; month: string; kind?: string; seq?: number; source?: unknown }, lang: "en" | "hi" = "en"): string {
  const group = run.payGroup as RunGroup;
  if (run.kind !== "SUPPLEMENTARY") return runTitle(group, run.month, lang);
  const src = (run.source ?? {}) as Partial<SupplementarySource>;
  const what =
    src.type === "ARREARS"
      ? lang === "hi"
        ? `बकाया ${formatMonth(src.fromMonth!, "hi")} – ${formatMonth(src.toMonth!, "hi")}`
        : `Arrears ${formatMonth(src.fromMonth!)} – ${formatMonth(src.toMonth!)}`
      : src.type === "WITHHELD"
        ? lang === "hi"
          ? "रोका गया वेतन"
          : "Pay withheld earlier"
        : src.type === "JOINER"
          ? lang === "hi"
            ? `कार्यग्रहण — ${formatMonth(src.forMonth!, "hi")} का वेतन`
            : `Joiners — pay for ${formatMonth(src.forMonth!)}`
          : src.type === "BENEFITS"
            ? lang === "hi"
              ? `सेवानिवृत्ति लाभ — ${src.name}`
              : `Retirement benefits — ${src.name}`
            : src.type === "SETTLEMENT"
              ? lang === "hi"
                ? `अंतिम निपटान — ${src.name}`
                : `Full and final settlement — ${src.name}`
              : "";
  return lang === "hi"
    ? `पूरक बिल ${run.seq ?? ""} · ${formatMonth(run.month, "hi")} — ${groupLabelHi[group]} — ${what}`
    : `Supplementary bill ${run.seq ?? ""} · ${formatMonth(run.month)} — ${groupLabel[group]} — ${what}`;
}

export const runTitle = (group: RunGroup, month: string, lang: "en" | "hi" = "en") =>
  group === "PENSION"
    ? lang === "hi"
      ? `पेंशन बिल ${formatMonth(month, "hi")}`
      : `Pension bill ${formatMonth(month)}`
    : lang === "hi"
      ? `वेतन ${formatMonth(month, "hi")} — ${groupLabelHi[group]}`
      : `Payroll ${formatMonth(month)} — ${groupLabel[group]}`;

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
  /** Loan instalments in a regular bill; month-by-month arrears in a supplementary one. */
  detail?: unknown;
  /** Pension slips: the pension paid (PN-02). */
  pensionerId?: string;
}

export interface PayAsOf {
  payLevel: string | null;
  payCell: number | null;
  postId: string;
}

/**
 * Pay level, cell and post in force on a date (PR-06, PR-07): the latest pay-history row on or before it, else the
 * employee record. Rows for the people asked are read once.
 */
export async function payAsOf(tx: DbLike, employees: { id: string; payLevel: string | null; payCell: number | null; postId: string }[], date: ISODate) {
  const rows = await tx.payHistory.findMany({ where: { employeeId: { in: employees.map((e) => e.id) }, effectiveFrom: { lte: fromISODate(date) } }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }] });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.employeeId)) latest.set(r.employeeId, r);
  return new Map<string, PayAsOf>(
    employees.map((e) => {
      const h = latest.get(e.id);
      return [e.id, h ? { payLevel: h.payLevel, payCell: h.payCell, postId: h.postId ?? e.postId } : { payLevel: e.payLevel, payCell: e.payCell, postId: e.postId }];
    }),
  );
}

export interface LoanDue {
  loanId: string;
  principal: number;
  interest: number;
}

/** PR-09: what each running loan recovers in a month, from recoveries through approved payrolls of earlier months. */
export async function loansDue(tx: DbLike, employeeIds: string[], month: string) {
  const loans = await tx.loan.findMany({ where: { employeeId: { in: employeeIds }, status: "RUNNING", startMonth: { lte: month } }, include: { recoveries: true }, orderBy: { sanctionDate: "asc" } });
  const out = new Map<string, LoanDue[]>();
  for (const l of loans) {
    const pos = loanPosition(
      loanTermsOf(l),
      l.recoveries.map((r) => ({ month: r.month, principal: num(r.principal), interest: num(r.interest) })),
      month,
    );
    if (pos.due.principal + pos.due.interest <= 0) continue;
    out.set(l.employeeId, [...(out.get(l.employeeId) ?? []), { loanId: l.id, ...pos.due }]);
  }
  return out;
}

/** For people leaving this month: what their loans still owe after this month's instalment (nothing owed: left out). */
async function loansLeftAfter(tx: DbLike, employeeIds: string[], month: string) {
  const paise = new Map<string, number>();
  if (!employeeIds.length) return paise;
  const loans = await tx.loan.findMany({ where: { employeeId: { in: employeeIds }, status: "RUNNING" }, include: { recoveries: true } });
  for (const l of loans) {
    const pos = loanPosition(loanTermsOf(l), l.recoveries.map((r) => ({ month: r.month, principal: num(r.principal), interest: num(r.interest) })), month);
    const left = toPaise(pos.principalLeft) + toPaise(pos.interestLeft) - toPaise(pos.due.principal) - toPaise(pos.due.interest);
    if (left > 0) paise.set(l.employeeId, (paise.get(l.employeeId) ?? 0) + left);
  }
  return new Map([...paise].map(([id, p]) => [id, fromPaise(p)]));
}

/**
 * Works out a pay group's month from the records as they stand: matrix and rates in force on the 1st, pay heads,
 * standing items, last month's locked attendance (D-17) and the bank details; then the worked-out deductions — loan
 * and GPF advance instalments, professional tax where levied, and TDS projected on the year (ST-04). Pure reading —
 * nothing is saved. `ignoreAttendance` (with `assumeWorkedDays` for daily wages) is for the demo history only.
 */
export async function computeRun(tx: DbLike, boardId: string, group: RunGroup, month: string, opts: { ignoreAttendance?: boolean; assumeWorkedDays?: number } = {}) {
  if (group === "PENSION") return computePensionRun(tx, boardId, month);
  const monthStart = `${month}-01`;
  const monthEnd = endOfMonth(monthStart);
  const dim = datesOfMonth(month).length;
  const last = shiftMonth(month, -1);
  const [employees, rates, matrix, headRows, sections, posts] = await Promise.all([
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
    tx.post.findMany({ where: { boardId } }),
  ]);
  const ids = employees.map((e) => e.id);
  const flags = headFlags(headRows);
  const lastDayIn = (e: { exitDate: Date | null }) => {
    const d = e.exitDate ? toISODate(e.exitDate) : null;
    return d && d >= monthStart && d <= monthEnd ? d : null;
  };
  const [items, locks, attMonths, lastSlips, holders, pays, loans, gpfRefunds, settings, taxCtx, leavingLoans] = await Promise.all([
    itemsFor(boardId, month, ids, tx),
    tx.attendanceLock.findMany({ where: { boardId, month: last, unlockedAt: null }, select: { sectionId: true } }),
    tx.attendanceMonth.findMany({ where: { employeeId: { in: ids }, month: last } }),
    // Last month's pay as approved — a draft that never went out is not "last month".
    tx.payslip.findMany({ where: { employeeId: { in: ids }, pensionerId: null, month: last, status: "INCLUDED", run: { status: { in: ["APPROVED", "PAID", "CLOSED"] } } }, select: { employeeId: true, net: true }, orderBy: { createdAt: "asc" } }),
    tx.employee.groupBy({ by: ["bankAccountHash"], where: { boardId, bankAccountHash: { not: null }, status: { in: ["ACTIVE", "SUSPENDED"] } }, _count: { _all: true } }),
    payAsOf(tx, employees, monthStart),
    loansDue(tx, ids, month),
    gpfRefundsDue(tx, ids, month),
    statutorySettings(tx, boardId),
    taxContext(tx, boardId, ids, month, flags),
    loansLeftAfter(tx, employees.filter((e) => lastDayIn(e)).map((e) => e.id), month),
  ]);
  const postBy = new Map(posts.map((p) => [p.id, p]));
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
    const pay = pays.get(e.id)!;
    const post = postBy.get(pay.postId) ?? e.post;
    const basic = isMatrix ? basicFrom(matrix?.levels, pay.payLevel, pay.payCell) : null;
    const noPayLevel = isMatrix ? basic === null : e.wageRate === null;
    const loanLines = loans.get(e.id) ?? [];
    const refunds = gpfRefunds.get(e.id) ?? [];
    const personItems = { ...(items.get(e.id) ?? {}) };
    // Worked out here, never standing amounts: a stray pay item for these heads is ignored.
    delete personItems.IT;
    delete personItems.PT;
    if (loanLines.length) personItems.LOAN = (personItems.LOAN ?? 0) + loanLines.reduce((s, l) => s + l.principal + l.interest, 0);
    if (refunds.length) personItems.GPF_REFUND = refunds.reduce((s, r) => s + r.amount, 0);
    const input: PayInput = {
      type: e.type,
      postCode: post.code,
      group: post.group,
      payLevel: pay.payLevel,
      basic,
      wageRate: e.wageRate === null ? null : num(e.wageRate),
      wageBasis: e.wageBasis,
      daysInMonth: dim,
      daysOnRoll,
      last: lastAtt,
      rates,
      heads,
      items: personItems,
    };
    let result = computePay(input);
    if (settings.professionalTax) {
      personItems.PT = professionalTaxFor(result.gross, settings.ptSlabs);
      result = computePay(input);
    }
    // ST-04: the year's tax, with the months to come at a full month's pay (daily wages: at this month's).
    const full = computePay({ ...input, daysOnRoll: dim, last: input.wageBasis === "DAILY" ? input.last : null });
    const monthly = full.gross >= result.gross ? full : result;
    const tax = projectTds(taxCtx, e.id, partsOf(result.lines, flags), partsOf(monthly.lines, flags), afterRetirement ? 0 : monthsStillToCome(month, taxCtx.fy, endBy));
    if (tax.monthly > 0) {
      personItems.IT = tax.monthly;
      result = computePay(input);
    }
    const lastNet = lastNetBy.get(e.id) ?? null;
    const pct = changePct(result.net, lastNet);
    slips.push({
      employeeId: e.id,
      sectionId: e.sectionId,
      postId: pay.postId,
      payLevel: pay.payLevel,
      payCell: pay.payCell,
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
      detail: { ...(loanLines.length ? { loans: loanLines } : {}), ...(refunds.length ? { gpfRefunds: refunds } : {}), tax },
    });
    const leavingOn = lastDayIn(e);
    facts.push({ employeeId: e.id, net: result.net, lastNet, hasBank: Boolean(e.bankAccountHash && e.ifsc), bankHash: e.bankAccountHash, afterRetirement, noPayLevel, suspended: e.status === "SUSPENDED", leaving: leavingOn ? { lastDay: leavingOn, loansLeft: leavingLoans.get(e.id) ?? 0 } : null });
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

export interface RunTarget {
  /** A supplementary bill being worked out again. */
  runId?: string;
  kind?: "REGULAR" | "SUPPLEMENTARY";
  title?: string;
  source?: unknown;
}

/**
 * Saves a worked-out run, carrying over resolutions that still apply. The regular bill is found by pay group and month;
 * a supplementary bill by its id, or created with the month's next number. Used by the run, S-42 and the demo seed.
 */
export async function saveRun(tx: Tx, who: { boardId: string; userId: string; name: string }, group: RunGroup, month: string, computed: { slips: ComputedSlip[]; found: Found[] }, target: RunTarget = {}) {
  const kind = target.kind ?? "REGULAR";
  const existing = target.runId
    ? await tx.payrollRun.findFirst({ where: { id: target.runId, boardId: who.boardId } })
    : kind === "REGULAR"
      ? await tx.payrollRun.findUnique({ where: { boardId_payGroup_month_kind_seq: { boardId: who.boardId, payGroup: group, month, kind, seq: 0 } } })
      : null;
  if (existing && existing.status !== "DRAFT") throw conflict("payroll.errors.notDraft");
  const seq =
    kind === "REGULAR" ? 0 : existing ? existing.seq : ((await tx.payrollRun.aggregate({ where: { boardId: who.boardId, payGroup: group, month, kind }, _max: { seq: true } }))._max.seq ?? 0) + 1;
  const extra = { title: target.title ?? existing?.title ?? null, source: target.source === undefined ? undefined : (target.source as Prisma.InputJsonValue) };
  const old = existing ? await tx.payrollException.findMany({ where: { runId: existing.id, resolution: { not: null } } }) : [];
  const oldBy = new Map(old.map((x) => [exceptionKey(x), x]));
  const run = existing
    ? await tx.payrollRun.update({ where: { id: existing.id }, data: { version: { increment: 1 }, runById: who.userId, runByName: who.name, runAt: new Date(), ...extra } })
    : await tx.payrollRun.create({ data: { boardId: who.boardId, payGroup: group, month, kind, seq, runById: who.userId, runByName: who.name, runAt: new Date(), ...extra } });
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
      detail: s.detail === undefined ? undefined : (s.detail as Prisma.InputJsonValue),
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
        ...(keep
          ? { resolution: prev.resolution, note: prev.note, resolvedById: prev.resolvedById, resolvedByName: prev.resolvedByName, resolvedAt: prev.resolvedAt }
          : f.resolved
            ? { resolution: f.resolved.resolution, note: f.resolved.note, resolvedByName: "System", resolvedAt: new Date() }
            : {}),
      };
    }),
  });
  await applyResolutions(tx, run.id);
  return run;
}


export { levelOrder } from "./matrix-7cpc";

/** PR-09: an approved payroll records each loan instalment it recovered; a loan repaid in full closes. */
export async function recordLoanRecoveries(tx: Tx, runId: string) {
  const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId } });
  const slips = await tx.payslip.findMany({ where: { runId, status: "INCLUDED" }, select: { detail: true } });
  const touched = new Set<string>();
  for (const s of slips) {
    for (const l of ((s.detail as { loans?: LoanDue[] } | null)?.loans ?? [])) {
      await tx.loanRecovery.upsert({
        where: { loanId_runId: { loanId: l.loanId, runId } },
        create: { loanId: l.loanId, runId, month: run.month, principal: l.principal, interest: l.interest },
        update: { principal: l.principal, interest: l.interest },
      });
      touched.add(l.loanId);
    }
  }
  await settleLoans(tx, [...touched], shiftMonth(run.month, 1));
}

/** Reopening a payroll (PR-13) takes its loan instalments back out. */
export async function undoLoanRecoveries(tx: Tx, runId: string) {
  const rows = await tx.loanRecovery.findMany({ where: { runId }, select: { loanId: true } });
  await tx.loanRecovery.deleteMany({ where: { runId } });
  await settleLoans(tx, [...new Set(rows.map((r) => r.loanId))], "9999-12");
}

/** Marks loans closed once nothing is left (recovery stops at zero), or running again if a recovery was undone. */
async function settleLoans(tx: Tx, loanIds: string[], asOfMonth: string) {
  for (const id of loanIds) {
    const l = await tx.loan.findUniqueOrThrow({ where: { id }, include: { recoveries: true } });
    if (l.status !== "RUNNING" && l.status !== "CLOSED") continue;
    const recovered = l.recoveries.map((r) => ({ month: r.month, principal: num(r.principal), interest: num(r.interest) }));
    const lastMonth = recovered.reduce((m, r) => (r.month > m ? r.month : m), "");
    const pos = loanPosition(loanTermsOf(l), recovered, lastMonth ? shiftMonth(lastMonth, 1) : asOfMonth);
    if (pos.closed && recovered.length) await tx.loan.update({ where: { id }, data: { status: "CLOSED", closedMonth: lastMonth } });
    else if (!pos.closed && l.status === "CLOSED") await tx.loan.update({ where: { id }, data: { status: "RUNNING", closedMonth: null } });
  }
}

/** Applies pay changes whose date has come (an increment approved in December for 1 January) to the employee record. */
export async function applyDuePayChanges(tx: Tx, boardId: string, today: ISODate) {
  const due = await tx.payHistory.findMany({ where: { boardId, applied: false, effectiveFrom: { lte: fromISODate(today) } }, orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }] });
  for (const h of due) {
    await tx.employee.update({ where: { id: h.employeeId }, data: { payLevel: h.payLevel, payCell: h.payCell, ...(h.postId ? { postId: h.postId } : {}) } });
    await tx.payHistory.update({ where: { id: h.id }, data: { applied: true } });
  }
  return due.length;
}
