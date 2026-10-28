import "server-only";
import { z } from "zod";
import { Prisma, type ApprovalTask, type Separation } from "@/generated/prisma/client";
import { submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db, type DbLike, type Tx } from "@/lib/db";
import { formatDate, formatMonth, fromISODate, isISODate, todayIST, toISODate, type ISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { formatINR, fromPaise, toPaise } from "@/lib/money";
import { emit } from "@/lib/outbox";
import { fullName } from "@/modules/employees/present";
import { applyExits, KIND_LABEL } from "@/modules/employees/separation";
import { creditPeriod } from "@/modules/leave/rules";
import { gpfFinal } from "@/modules/pension/case-facts";
import { settleGpf } from "@/modules/pension/cases";
import { saveSupplementary } from "./arrears";
import { basicFrom, matrixOn, payAsOf, ratesOn, runTitle, titleOf, type StaffGroup } from "./compute";
import { payGroupOf, WORKED_OUT, type PayLine } from "./engine";
import { loanPosition, loanTermsOf } from "./loan-rules";
import { closeSettlement } from "./settlement-bill";
import {
  elNotEarned,
  encashableDays,
  instalmentsLeft,
  isExit,
  leaveEncashment,
  paidBeyond,
  scaleLines,
  totalsOf,
  withheldDue,
  type ExitKind,
  type StatementLine,
  type StatementTotals,
} from "./settlement-rules";

/**
 * Client add-on: the full and final settlement of someone leaving service. The Payroll clerk works out a statement
 * from the records — dues (pay withheld earlier, leave encashment, anything owed by order) and every recovery still
 * outstanding (each running loan with its interest, pay drawn for days after the last day, instalments of standing
 * recoveries still to come, anything else by order) — sends it to a Checker and an Admin, and then either pays the net
 * by a supplementary "settlement" bill (whose approval records the loan recoveries and closes the loans and the GPF
 * account) or, when the recoveries are more than the dues, records the money the person pays back.
 */
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;
const MATRIX_TYPES = ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION"];
const LOAN_NAMES: Record<string, [string, string]> = {
  HBA: ["House building advance", "गृह निर्माण अग्रिम"],
  VEHICLE: ["Vehicle advance", "वाहन अग्रिम"],
  COMPUTER: ["Computer advance", "कंप्यूटर अग्रिम"],
  FESTIVAL: ["Festival advance", "त्योहार अग्रिम"],
  OTHER: ["Loan", "ऋण"],
};

/** Payroll prepares; Payroll, Checkers and Admins see the money (§14 arrears and loans row). */
const canPrepare = (actor: Actor) => canAll(actor, "arrears_loans", "create");
export const canSeeSettlement = (actor: Actor) => canAll(actor, "arrears_loans", "view");

export const settlementInputSchema = z.object({
  /** Leave days to pay, when the order differs from the rule (with the reason). */
  leaveDays: z.coerce.number().min(0, "validation.invalid").max(300, "validation.invalid").nullable().optional(),
  leaveNote: z.string().trim().max(300).optional().nullable().transform((v) => v || null),
  lines: z
    .array(
      z.object({
        kind: z.enum(["DUE", "RECOVERY"]),
        label: z.string().trim().min(3, "validation.tooShort").max(120),
        amount: z.coerce.number().positive("validation.invalid").max(10_000_000, "validation.invalid"),
      }),
    )
    .max(20)
    .default([]),
  /** Withheld pay to release (true) or leave out (false) — by payslip; otherwise the default. */
  withheld: z.record(z.string(), z.boolean()).default({}),
});
export type SettlementInputs = z.infer<typeof settlementInputSchema>;
const EMPTY: SettlementInputs = { leaveDays: null, leaveNote: null, lines: [], withheld: {} };

export interface Statement {
  separationId: string;
  kind: ExitKind;
  lastDay: ISODate;
  /** The month it was worked out for (interest on loans runs to it). */
  month: string;
  workedOn: ISODate;
  payGroup: StaffGroup;
  lines: StatementLine[];
  totals: StatementTotals;
  leave: { balance: number; notEarned: number; ruleDays: number; days: number; changed: boolean; note: string | null; pay: number; daPercent: number; withDa: number; amount: number } | null;
  gpf: { balance: number; interest: number; total: number; advanceLeft: number } | null;
  nps: boolean;
  withheld: { slipId: string; month: string; due: number; release: boolean; reason: string | null; notDue: boolean; partDays: number | null }[];
  pendingLoans: { id: string; type: string; principal: number }[];
  /** Bills that must be approved before the settlement can be sent (the month of leaving must be paid first). */
  waitFor: { runId: string | null; title: string; titleHi: string }[];
  lastDayPassed: boolean;
}

/** Withheld payslips already paid by a supplementary bill (withheld pay or a settlement). */
async function paidElsewhere(tx: DbLike, employeeId: string) {
  const supp = await tx.payslip.findMany({ where: { employeeId, run: { kind: "SUPPLEMENTARY" } }, select: { detail: true } });
  const ids = new Set<string>();
  for (const s of supp) {
    const d = (s.detail ?? {}) as { withheldSlipId?: string; withheldSlipIds?: string[] };
    if (d.withheldSlipId) ids.add(d.withheldSlipId);
    for (const id of d.withheldSlipIds ?? []) ids.add(id);
  }
  return ids;
}

/** Works the statement out afresh from the records and what the clerk entered. Nothing is saved. */
export async function workStatement(tx: DbLike, sep: Pick<Separation, "id" | "boardId" | "employeeId" | "kind" | "effectiveDate" | "settlementRunId">, inputs: SettlementInputs, today: ISODate = todayIST()): Promise<Statement> {
  if (!isExit(sep.kind)) throw badRequest("payroll.settlement.errors.notExit");
  const kind = sep.kind;
  const boardId = sep.boardId;
  const e = await tx.employee.findUniqueOrThrow({ where: { id: sep.employeeId }, include: { post: true } });
  const lastDay = toISODate(sep.effectiveDate);
  const lastMonth = lastDay.slice(0, 7);
  const month = today.slice(0, 7) > lastMonth ? today.slice(0, 7) : lastMonth;
  const group = payGroupOf(e.type);
  const isMatrix = MATRIX_TYPES.includes(e.type);
  const period = creditPeriod("HALF_YEARLY", lastDay);

  const [rates, matrix, npaHead, elSum, elCredit, elLater, elType, slips, withheldSlips, taken, loans, pendingLoans, items, heads, openRuns, regular, gpf, advances] = await Promise.all([
    ratesOn(boardId, lastDay, tx),
    matrixOn(boardId, lastDay, tx),
    tx.payHead.findUnique({ where: { boardId_code: { boardId, code: "NPA" } } }),
    tx.leaveLedger.aggregate({ where: { employeeId: e.id, leaveCode: "EL" }, _sum: { days: true } }),
    tx.leaveLedger.findFirst({ where: { employeeId: e.id, leaveCode: "EL", kind: "CREDIT", period: period.id } }),
    tx.leaveLedger.aggregate({ where: { employeeId: e.id, leaveCode: "EL", kind: "CREDIT", date: { gt: fromISODate(lastDay) }, period: { not: period.id } }, _sum: { days: true } }),
    tx.leaveType.findFirst({ where: { boardId, code: "EL" } }),
    tx.payslip.findMany({ where: { employeeId: e.id, pensionerId: null, status: "INCLUDED", month: { gte: lastMonth }, run: { kind: "REGULAR", status: { in: [...PAID] } } }, orderBy: { month: "asc" } }),
    tx.payslip.findMany({ where: { employeeId: e.id, pensionerId: null, status: "WITHHELD", run: { kind: "REGULAR", status: { in: [...PAID] } } }, orderBy: { month: "asc" } }),
    paidElsewhere(tx, e.id),
    tx.loan.findMany({ where: { employeeId: e.id, status: "RUNNING" }, include: { recoveries: true }, orderBy: { sanctionDate: "asc" } }),
    tx.loan.findMany({ where: { employeeId: e.id, status: "PENDING" }, select: { id: true, type: true, principal: true } }),
    tx.employeePayItem.findMany({ where: { employeeId: e.id, toMonth: { gt: lastMonth } }, orderBy: { fromMonth: "asc" } }),
    tx.payHead.findMany({ where: { boardId } }),
    tx.payrollRun.findMany({ where: { boardId, status: { in: ["DRAFT", "CHECKING", "APPROVING"] }, payslips: { some: { employeeId: e.id, pensionerId: null } }, ...(sep.settlementRunId ? { id: { not: sep.settlementRunId } } : {}) } }),
    tx.payrollRun.findUnique({ where: { boardId_payGroup_month_kind_seq: { boardId, payGroup: group, month: lastMonth, kind: "REGULAR", seq: 0 } } }),
    e.type === "PERMANENT_OPS" ? gpfFinal(tx, boardId, e.id, lastMonth) : null,
    tx.gpfAdvance.findMany({ where: { employeeId: e.id, kind: "ADVANCE", status: "RUNNING" }, include: { entries: { where: { kind: "REFUND" }, select: { amount: true } } } }),
  ]);
  const headOf = new Map(heads.map((h) => [h.code, h]));
  const lines: StatementLine[] = [];

  // Pay withheld earlier: released (its own deductions taken, the loan instalment left to the loans below) or left out.
  const withheld: Statement["withheld"] = [];
  for (const s of withheldSlips) {
    if (taken.has(s.id)) continue;
    const notDue = s.month > lastMonth;
    const def = !notDue && !(s.withheldReason ?? "").includes("SUSPENDED");
    const release = !notDue && (inputs.withheld[s.id] ?? def);
    const paidDays = num(s.daysOnRoll) || s.daysInMonth;
    const dueDays = s.month === lastMonth ? Math.min(paidDays, Number(lastDay.slice(8, 10))) : paidDays;
    const factor = dueDays / paidDays;
    let slipLines = s.lines as unknown as PayLine[];
    let gpfRefunds = ((s.detail as { gpfRefunds?: { advanceId: string; amount: number }[] } | null)?.gpfRefunds ?? []);
    if (factor < 1) {
      // Part of the month: every head by days; the GPF advance instalment is left to the GPF final payment.
      slipLines = scaleLines(slipLines.filter((l) => l.code !== "GPF_REFUND"), factor);
      gpfRefunds = [];
    }
    const due = withheldDue(slipLines);
    withheld.push({ slipId: s.id, month: s.month, due, release, reason: s.withheldReason, notDue, partDays: factor < 1 ? dueDays : null });
    if (release && due > 0) {
      lines.push({
        key: `withheld:${s.id}`,
        kind: "DUE",
        source: "WITHHELD",
        label: `Pay for ${formatMonth(s.month)} withheld earlier`,
        labelHi: `${formatMonth(s.month, "hi")} का रोका गया वेतन`,
        note: factor < 1 ? `${dueDays} of ${paidDays} days, after its own deductions` : "After its own deductions",
        noteHi: factor < 1 ? `${paidDays} में से ${dueDays} दिन, कटौतियों के बाद` : "कटौतियों के बाद",
        amount: due,
        headCode: "OTHER_DUE",
        slip: { id: s.id, month: s.month, lines: slipLines, gpfRefunds },
      });
    }
  }

  // Leave encashment: the earned leave balance less the half-year's credit not earned, by the rule for this kind of leaving.
  let leave: Statement["leave"] = null;
  if (elType) {
    const later = num(elLater._sum.days);
    const notEarned = elCredit ? elNotEarned({ days: num(elCredit.days), periodStart: period.start, periodEnd: period.end, fullCredit: num(elType.creditDays) }, toISODate(e.dateOfJoining), lastDay) + later : later;
    const balance = Math.max(0, num(elSum._sum.days));
    const ruleDays = encashableDays(kind, Math.max(0, balance - notEarned));
    const days = inputs.leaveDays ?? ruleDays;
    const pay = await payOnLastDay(tx, e, lastDay, isMatrix, matrix?.levels, npaHead);
    const daPercent = isMatrix ? (rates.DA_PERCENT ?? 0) : 0;
    const enc = leaveEncashment(days, pay, daPercent);
    if (balance > 0 || days > 0) leave = { balance, notEarned, ruleDays, days, changed: inputs.leaveDays !== null && inputs.leaveDays !== undefined && inputs.leaveDays !== ruleDays, note: inputs.leaveNote ?? null, pay, daPercent, withDa: enc.withDa, amount: enc.amount };
    if (enc.amount > 0) {
      lines.push({
        key: "leave",
        kind: "DUE",
        source: "LEAVE",
        label: `Leave encashment — ${days} days of earned leave`,
        labelHi: `अवकाश नकदीकरण — ${days} दिन अर्जित अवकाश`,
        note: `${days} × ${formatINR(enc.withDa)} ÷ 30 (pay with DA on the last day)`,
        noteHi: `${days} × ${formatINR(enc.withDa)} ÷ 30 (अंतिम दिन का वेतन + महँगाई भत्ता)`,
        amount: enc.amount,
        headCode: "LEAVE_ENCASHMENT",
      });
    }
  }

  // Dues and recoveries entered by hand, with the order (subsistence allowance, notice pay, no-dues from a section …).
  inputs.lines.forEach((m, i) => {
    lines.push({ key: `manual:${i}`, kind: m.kind, source: "MANUAL", label: m.label, labelHi: m.label, amount: m.amount, headCode: m.kind === "DUE" ? "OTHER_DUE" : "RECOVERY" });
  });

  // Every running loan in full: the principal left and the interest to this month.
  for (const l of loans) {
    const pos = loanPosition(loanTermsOf(l), l.recoveries.map((r) => ({ month: r.month, principal: num(r.principal), interest: num(r.interest) })), month);
    const left = fromPaise(toPaise(pos.principalLeft) + toPaise(pos.interestLeft));
    if (left <= 0) continue;
    const [name, nameHi] = LOAN_NAMES[l.type] ?? LOAN_NAMES.OTHER;
    // The purpose is shown when it says more than the kind of loan ("Festival advance — Festival advance" reads badly).
    const purpose = l.purpose && l.purpose.trim().toLowerCase() !== name.toLowerCase() ? l.purpose.trim() : null;
    lines.push({
      key: `loan:${l.id}`,
      kind: "RECOVERY",
      source: "LOAN",
      label: `${name}${purpose ? ` — ${purpose}` : ""}`,
      labelHi: `${nameHi}${purpose ? ` — ${purpose}` : ""}`,
      note: `Principal left ${formatINR(pos.principalLeft)}${pos.interestLeft ? ` + interest ${formatINR(pos.interestLeft)}` : ""} · order ${l.orderNumber ?? "—"} of ${formatDate(toISODate(l.sanctionDate))}`,
      noteHi: `शेष मूलधन ${formatINR(pos.principalLeft)}${pos.interestLeft ? ` + ब्याज ${formatINR(pos.interestLeft)}` : ""} · आदेश ${l.orderNumber ?? "—"}, ${formatDate(toISODate(l.sanctionDate), "hi")}`,
      amount: left,
      headCode: "LOAN",
      loan: { loanId: l.id, principal: pos.principalLeft, interest: pos.interestLeft },
    });
  }

  // Pay drawn in approved bills for days after the last day.
  for (const s of slips) {
    const over = paidBeyond({ month: s.month, net: num(s.net), daysOnRoll: num(s.daysOnRoll), daysInMonth: s.daysInMonth }, lastDay);
    if (over.amount <= 0) continue;
    lines.push({
      key: `overpaid:${s.id}`,
      kind: "RECOVERY",
      source: "OVERPAID",
      label: `Pay drawn after the last day — ${formatMonth(s.month)}`,
      labelHi: `अंतिम दिन के बाद लिया गया वेतन — ${formatMonth(s.month, "hi")}`,
      note: `${over.days} days of net pay ${formatINR(num(s.net))}`,
      noteHi: `शुद्ध वेतन ${formatINR(num(s.net))} के ${over.days} दिन`,
      amount: over.amount,
      headCode: "RECOVERY",
    });
  }

  // Standing recoveries with an end month: the instalments still to come, at once.
  for (const it of items) {
    const h = headOf.get(it.headCode);
    if (!h || h.kind !== "DEDUCTION" || h.calc !== "ITEM" || WORKED_OUT.has(it.headCode)) continue;
    const left = instalmentsLeft({ amount: num(it.amount), fromMonth: it.fromMonth, toMonth: it.toMonth }, lastMonth);
    if (left.amount <= 0) continue;
    lines.push({
      key: `item:${it.id}`,
      kind: "RECOVERY",
      source: "ITEM",
      label: `${h.name}${it.note ? ` — ${it.note}` : ""}`,
      labelHi: `${h.nameHi}${it.note ? ` — ${it.note}` : ""}`,
      note: `${formatINR(num(it.amount))} × ${left.months} months left (to ${formatMonth(it.toMonth!)})`,
      noteHi: `${formatINR(num(it.amount))} × ${left.months} शेष माह (${formatMonth(it.toMonth!, "hi")} तक)`,
      amount: left.amount,
      headCode: it.headCode,
    });
  }

  const waitFor: Statement["waitFor"] = openRuns.map((r) => ({ runId: r.id, title: runTitle(r.payGroup as StaffGroup, r.month), titleHi: runTitle(r.payGroup as StaffGroup, r.month, "hi") }));
  const regularPaid = regular && (PAID as readonly string[]).includes(regular.status);
  if (!regularPaid && !waitFor.some((w) => w.runId === regular?.id)) waitFor.push({ runId: regular?.id ?? null, title: runTitle(group, lastMonth), titleHi: runTitle(group, lastMonth, "hi") });

  const advanceLeft = advances.reduce((t, a) => t + Math.max(0, num(a.amount) - a.entries.reduce((s, x) => s + num(x.amount), 0)), 0);
  return {
    separationId: sep.id,
    kind,
    lastDay,
    month,
    workedOn: today,
    payGroup: group,
    lines,
    totals: totalsOf(lines),
    leave,
    gpf: gpf ? { balance: gpf.balance, interest: gpf.interest, total: fromPaise(toPaise(gpf.balance) + toPaise(gpf.interest)), advanceLeft } : null,
    nps: e.type === "PERMANENT_NPS",
    withheld,
    pendingLoans: pendingLoans.map((l) => ({ id: l.id, type: l.type, principal: num(l.principal) })),
    waitFor,
    lastDayPassed: lastDay < today,
  };
}

/** Basic (+ NPA) on the last day from the dated matrix and the pay history; a monthly wage for wage workers. */
async function payOnLastDay(
  tx: DbLike,
  e: { id: string; payLevel: string | null; payCell: number | null; postId: string; wageRate: unknown; wageBasis: string | null; post: { code: string } },
  lastDay: ISODate,
  isMatrix: boolean,
  levels: Record<string, number[]> | undefined,
  npaHead: { isActive: boolean; postCodes: string[]; value: unknown } | null,
) {
  if (!isMatrix) return e.wageBasis === "MONTHLY" ? num(e.wageRate as number | null) : 0;
  const pay = (await payAsOf(tx, [e], lastDay)).get(e.id)!;
  const basic = basicFrom(levels, pay.payLevel, pay.payCell) ?? 0;
  const npa = npaHead && npaHead.isActive && npaHead.postCodes.includes(e.post.code) ? Math.round((basic * num(npaHead.value as number)) / 100) : 0;
  return basic + npa;
}

// ─── The screen ───────────────────────────────────────────────────────────────

interface Receipt {
  receiptNo: string;
  date: ISODate;
  amount: number;
  byName: string;
  at: string;
}

async function loadExit(actor: Actor, id: string, tx: DbLike = db) {
  const sep = await tx.separation.findFirst({ where: { id, boardId: actor.boardId }, include: { employee: { select: { id: true, firstName: true, middleName: true, lastName: true, nameHi: true, employeeCode: true, type: true, status: true } } } });
  if (!sep) throw notFound();
  if (!isExit(sep.kind) || sep.status !== "APPROVED") throw conflict("payroll.settlement.errors.notExit");
  return sep;
}

const inputsOf = (sep: { inputs: unknown }): SettlementInputs => ({ ...EMPTY, ...((sep.inputs as Partial<SettlementInputs> | null) ?? {}) });

/** The settlement as the screen shows it: the statement (fixed once sent), what can be done next, the bill or receipts. */
export async function settlementView(actor: Actor, id: string) {
  if (!canSeeSettlement(actor)) throw forbidden();
  const sep = await db.separation.findFirst({ where: { id, boardId: actor.boardId } });
  if (!sep) throw notFound();
  if (!isExit(sep.kind) || sep.status !== "APPROVED") return null;
  const inputs = inputsOf(sep);
  const statement = sep.statement ? (sep.statement as unknown as Statement) : await workStatement(db, sep, inputs);
  const [run, task] = await Promise.all([
    sep.settlementRunId ? db.payrollRun.findUnique({ where: { id: sep.settlementRunId }, select: { id: true, status: true, month: true, seq: true, payGroup: true, kind: true, source: true, net: true } }) : null,
    db.approvalTask.findFirst({ where: { boardId: actor.boardId, kind: "separation.settlement", entityId: sep.id, status: "PENDING" }, select: { id: true, requiredPermission: true, makerId: true } }),
  ]);
  const receipts = (sep.receipts as Receipt[] | null) ?? [];
  const received = fromPaise(receipts.reduce((t, r) => t + toPaise(r.amount), 0));
  const own = sep.employeeId === actor.employeeId;
  const prepare = canPrepare(actor) && !own;
  return {
    status: sep.settlementStatus,
    inputs,
    statement,
    frozen: Boolean(sep.statement),
    run: run ? { id: run.id, status: run.status, net: num(run.net), title: titleOf(run), titleHi: titleOf(run, "hi") } : null,
    task,
    receipts,
    received,
    stillToRecover: fromPaise(Math.max(0, toPaise(statement.totals.toRecover) - toPaise(received))),
    settledAt: sep.settledAt ? sep.settledAt.toISOString() : null,
    canEdit: prepare && sep.settlementStatus === "NONE",
    canSubmit: prepare && sep.settlementStatus === "NONE" && statement.waitFor.length === 0 && statement.lastDayPassed,
    canMakeBill: !own && canAll(actor, "payroll", "create") && sep.settlementStatus === "APPROVED" && statement.totals.payable > 0 && !run,
    canRecordReceipt: prepare && sep.settlementStatus === "APPROVED" && statement.totals.toRecover > 0,
  };
}

export type SettlementView = NonNullable<Awaited<ReturnType<typeof settlementView>>>;

/** The clerk's entries (leave days, lines by hand, withheld pay) — saved while the statement is still a draft. */
export async function saveSettlementInputs(actor: Actor, id: string, raw: unknown) {
  if (!canPrepare(actor)) throw forbidden();
  const input = settlementInputSchema.parse(raw);
  const sep = await loadExit(actor, id);
  if (sep.employeeId === actor.employeeId) throw forbidden("errors.ownPay");
  if (sep.settlementStatus !== "NONE") throw conflict("payroll.settlement.errors.notDraft");
  if (input.leaveDays !== null && input.leaveDays !== undefined && !input.leaveNote) throw badRequest("errors.validation", { leaveNote: "payroll.settlement.errors.leaveNote" });
  return db.$transaction(async (tx) => {
    await tx.separation.update({ where: { id }, data: { inputs: input as unknown as Prisma.InputJsonValue } });
    await audit(tx, actor, { action: "UPDATE", entityType: "Separation", entityId: id, summary: `Settlement entries saved for ${fullName(sep.employee)}: ${input.lines.length} lines by hand${input.leaveDays !== null && input.leaveDays !== undefined ? `, leave ${input.leaveDays} days (${input.leaveNote})` : ""}`, newValue: input, sensitive: true });
    return { ok: true };
  });
}

/** The statement goes to a Checker (then an Admin) and is fixed from then on. */
export async function submitSettlement(actor: Actor, id: string, raw: unknown) {
  if (!canPrepare(actor)) throw forbidden();
  const { note } = z.object({ note: z.string().trim().max(500).optional().nullable() }).parse(raw ?? {});
  await applyExits(actor.boardId);
  const sep = await loadExit(actor, id);
  if (sep.employeeId === actor.employeeId) throw forbidden("errors.ownPay");
  if (sep.settlementStatus !== "NONE") throw conflict("payroll.settlement.errors.notDraft");
  const statement = await workStatement(db, sep, inputsOf(sep));
  if (!statement.lastDayPassed) throw badRequest("payroll.settlement.errors.lastDayAhead", undefined, { date: formatDate(statement.lastDay) });
  if (statement.waitFor.length) throw badRequest("payroll.settlement.errors.waitFor", undefined, { title: statement.waitFor[0].title });
  const t = statement.totals;
  const rows: NonNullable<ApprovalDetails["rows"]> = [
    { label: "Employee", labelHi: "कर्मचारी", new: `${fullName(sep.employee)} (${sep.employee.employeeCode ?? "—"})` },
    { label: "Leaving", labelHi: "सेवा छोड़ना", new: `${KIND_LABEL[sep.kind][0]} — last day ${formatDate(statement.lastDay)}` },
    ...statement.lines.map((l) => ({ label: `${l.kind === "DUE" ? "Due" : "Recover"}: ${l.label}`, labelHi: `${l.kind === "DUE" ? "देय" : "वसूली"}: ${l.labelHi}`, new: formatINR(l.amount) })),
    { label: "Total dues", labelHi: "कुल देय", new: formatINR(t.dues) },
    { label: "Total recoveries", labelHi: "कुल वसूली", new: formatINR(t.recoveries) },
    t.toRecover > 0 ? { label: "To be paid back by the person", labelHi: "कर्मचारी से वसूली योग्य", new: formatINR(t.toRecover) } : { label: "Net payable", labelHi: "शुद्ध देय", new: formatINR(t.payable) },
  ];
  if (statement.gpf) rows.push({ label: "GPF final payment (from the fund)", labelHi: "जीपीएफ अंतिम भुगतान (निधि से)", new: formatINR(statement.gpf.total) });
  return db.$transaction(async (tx) => {
    const fresh = await tx.separation.updateMany({ where: { id, settlementStatus: "NONE" }, data: { settlementStatus: "CHECKING", statement: statement as unknown as Prisma.InputJsonValue } });
    if (!fresh.count) throw conflict("payroll.settlement.errors.notDraft");
    return submitForApproval(tx, actor, {
      kind: "separation.settlement",
      title: `Full and final settlement — ${fullName(sep.employee)} (${sep.employee.employeeCode ?? "—"})`,
      titleHi: `अंतिम निपटान — ${sep.employee.nameHi ?? fullName(sep.employee)} (${sep.employee.employeeCode ?? "—"})`,
      details: { rows, summary: note ?? undefined, link: `/employees/exits/${id}` } satisfies ApprovalDetails,
      payload: { separationId: id },
      subjectEmployeeId: sep.employeeId,
      entityType: "Separation",
      entityId: id,
      note: note ?? null,
    });
  });
}

/**
 * The Admin approves the statement. With nothing to pay, the GPF account is closed now; with nothing to pay and nothing
 * to recover, the settlement is complete (the loans are settled from the dues). Otherwise a settlement bill or the
 * person's repayment completes it.
 */
export async function onSettlementApproved(tx: Tx, task: ApprovalTask, actor: Actor, id: string) {
  const sep = await tx.separation.findUniqueOrThrow({ where: { id }, include: { employee: true } });
  if (sep.settlementStatus !== "CHECKING" || !sep.statement) throw conflict("payroll.settlement.errors.notChecking");
  const st = sep.statement as unknown as Statement;
  await tx.separation.update({ where: { id }, data: { settlementStatus: "APPROVED" } });
  if (st.totals.payable === 0) await settleGpf(tx, sep.employeeId, null, task.makerId);
  if (st.totals.payable === 0 && st.totals.toRecover === 0) await closeSettlement(tx, sep, st, { month: todayIST().slice(0, 7), recoveredBy: `settlement:${sep.id}` });
  await audit(tx, actor, { action: "APPROVE", entityType: "Separation", entityId: id, summary: `Full and final settlement of ${fullName(sep.employee)} approved — dues ${formatINR(st.totals.dues)}, recoveries ${formatINR(st.totals.recoveries)}, ${st.totals.toRecover > 0 ? `${formatINR(st.totals.toRecover)} to be paid back` : `net ${formatINR(st.totals.payable)}`}`, newValue: { taskId: task.id, totals: st.totals }, sensitive: true });
  await emit(tx, sep.boardId, "separation.settlement_approved", { type: "Separation", id }, { employeeId: sep.employeeId, ...st.totals });
}

/** Returned or rejected: back to a draft that is worked out afresh. */
export async function onSettlementSentBack(tx: Tx, id: string) {
  await tx.separation.updateMany({ where: { id, settlementStatus: "CHECKING" }, data: { settlementStatus: "NONE", statement: Prisma.DbNull } });
}

/** Payroll makes the settlement bill (a supplementary bill) that pays the net; it then goes through the usual stages. */
export async function makeSettlementBill(actor: Actor, id: string) {
  if (!canAll(actor, "payroll", "create")) throw forbidden();
  const sep = await loadExit(actor, id);
  if (sep.employeeId === actor.employeeId) throw forbidden("errors.ownPay");
  if (sep.settlementStatus !== "APPROVED" || !sep.statement) throw conflict("payroll.settlement.errors.notApproved");
  const st = sep.statement as unknown as Statement;
  if (st.totals.payable <= 0) throw badRequest("payroll.settlement.errors.nothingToPay");
  if (sep.settlementRunId && (await db.payrollRun.count({ where: { id: sep.settlementRunId } }))) throw conflict("payroll.settlement.errors.billExists");
  return saveSupplementary(actor, { type: "SETTLEMENT", payGroup: st.payGroup, separationId: sep.id, name: fullName(sep.employee) }, todayIST().slice(0, 7), undefined, async (tx, run) => {
    await tx.separation.update({ where: { id: sep.id }, data: { settlementRunId: run.id } });
  });
}

export const receiptSchema = z.object({
  receiptNo: z.string().trim().min(2, "validation.tooShort").max(60),
  date: z.string().refine(isISODate, "validation.date"),
  amount: z.coerce.number().positive("validation.invalid").max(10_000_000, "validation.invalid"),
});

/** When the recoveries are more than the dues: money paid back by the person (receipt by receipt) until it is all in. */
export async function recordReceipt(actor: Actor, id: string, raw: unknown) {
  if (!canPrepare(actor)) throw forbidden();
  const input = receiptSchema.parse(raw);
  if (input.date > todayIST()) throw badRequest("errors.validation", { date: "employees.exit.errors.orderFuture" });
  const sep = await loadExit(actor, id);
  if (sep.employeeId === actor.employeeId) throw forbidden("errors.ownPay");
  if (sep.settlementStatus !== "APPROVED" || !sep.statement) throw conflict("payroll.settlement.errors.notApproved");
  const st = sep.statement as unknown as Statement;
  const receipts = ((sep.receipts as Receipt[] | null) ?? []).slice();
  const before = receipts.reduce((t, r) => t + toPaise(r.amount), 0);
  const left = toPaise(st.totals.toRecover) - before;
  if (left <= 0) throw conflict("payroll.settlement.errors.nothingToRecover");
  if (toPaise(input.amount) > left) throw badRequest("errors.validation", { amount: "payroll.settlement.errors.moreThanDue" });
  receipts.push({ ...input, byName: actor.name, at: new Date().toISOString() });
  const done = toPaise(input.amount) === left;
  return db.$transaction(async (tx) => {
    await tx.separation.update({ where: { id }, data: { receipts: receipts as unknown as Prisma.InputJsonValue } });
    if (done) await closeSettlement(tx, sep, st, { month: todayIST().slice(0, 7), recoveredBy: `settlement:${sep.id}` });
    await audit(tx, actor, { action: "CREATE", entityType: "Separation", entityId: id, summary: `Money paid back by ${fullName(sep.employee)}: ${formatINR(input.amount)}, receipt ${input.receiptNo} of ${formatDate(input.date)}${done ? " — settlement complete" : ""}`, newValue: input, sensitive: true });
    await emit(tx, sep.boardId, "separation.receipt", { type: "Separation", id }, { amount: input.amount, settled: done });
    return { settled: done };
  });
}

/**
 * For a suspension: the loans and recoveries on record now — what a removal or dismissal would recover in the
 * settlement. Only to logins that see loans (§14 arrears and loans).
 */
export async function duesOnRecord(actor: Actor, employeeId: string) {
  if (!canSeeSettlement(actor)) return null;
  const month = todayIST().slice(0, 7);
  const [loans, items, heads, advances] = await Promise.all([
    db.loan.findMany({ where: { employeeId, boardId: actor.boardId, status: "RUNNING" }, include: { recoveries: true }, orderBy: { sanctionDate: "asc" } }),
    db.employeePayItem.findMany({ where: { employeeId, boardId: actor.boardId, toMonth: { gte: month } } }),
    db.payHead.findMany({ where: { boardId: actor.boardId, kind: "DEDUCTION", calc: "ITEM" } }),
    db.gpfAdvance.findMany({ where: { employeeId, boardId: actor.boardId, kind: "ADVANCE", status: "RUNNING" }, include: { entries: { where: { kind: "REFUND" }, select: { amount: true } } } }),
  ]);
  const headOf = new Map(heads.map((h) => [h.code, h]));
  const rows: { key: string; label: string; labelHi: string; note: string; amount: number }[] = [];
  for (const l of loans) {
    const pos = loanPosition(loanTermsOf(l), l.recoveries.map((r) => ({ month: r.month, principal: num(r.principal), interest: num(r.interest) })), month);
    const left = fromPaise(toPaise(pos.principalLeft) + toPaise(pos.interestLeft));
    if (left <= 0) continue;
    const [name, nameHi] = LOAN_NAMES[l.type] ?? LOAN_NAMES.OTHER;
    rows.push({ key: l.id, label: name, labelHi: nameHi, note: `${formatINR(pos.principalLeft)} + ${formatINR(pos.interestLeft)}`, amount: left });
  }
  for (const it of items) {
    const h = headOf.get(it.headCode);
    if (!h || WORKED_OUT.has(it.headCode)) continue;
    const left = instalmentsLeft({ amount: num(it.amount), fromMonth: it.fromMonth, toMonth: it.toMonth }, month);
    const thisMonth = it.fromMonth <= month ? num(it.amount) : 0;
    const amount = fromPaise(toPaise(left.amount) + toPaise(thisMonth));
    if (amount > 0) rows.push({ key: it.id, label: h.name, labelHi: h.nameHi, note: `${formatINR(num(it.amount))} × ${left.months + (thisMonth ? 1 : 0)}`, amount });
  }
  const gpfAdvanceLeft = advances.reduce((t, a) => t + Math.max(0, num(a.amount) - a.entries.reduce((s, x) => s + num(x.amount), 0)), 0);
  return { rows, total: fromPaise(rows.reduce((t, r) => t + toPaise(r.amount), 0)), gpfAdvanceLeft };
}
