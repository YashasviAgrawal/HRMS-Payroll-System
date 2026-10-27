import "server-only";
import { z } from "zod";
import type { ApprovalTask } from "@/generated/prisma/client";
import { submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db, type Tx } from "@/lib/db";
import { formatDate, formatMonth, fromISODate, isMonth, todayIST, toISODate } from "@/lib/dates";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { formatINR, fromPaise, toPaise } from "@/lib/money";
import { emit } from "@/lib/outbox";
import { isoDateField } from "@/lib/validators";
import { fullName } from "@/modules/employees/present";
import { loanPosition, loanSchedule, loanTermsOf } from "./loan-rules";

/**
 * PR-09, S-43: loans and advances. Payroll sanctions (with the order number), a Checker checks and an Admin approves
 * (§14 arrears and loans row). Each month's payroll recovers the instalment; the recovery is recorded when that payroll
 * is approved and taken back if it is reopened; recovery stops at zero and the loan closes.
 */
export const LOAN_TYPES = ["HBA", "VEHICLE", "COMPUTER", "FESTIVAL", "OTHER"] as const;

const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const canMake = (actor: Actor) => canAll(actor, "arrears_loans", "create");
const canSee = (actor: Actor) => canAll(actor, "arrears_loans", "view");

export const loanSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(LOAN_TYPES),
  purpose: z.string().trim().max(200).optional(),
  principal: z.coerce.number().positive("validation.invalid").max(10_000_000),
  interestRate: z.coerce.number().min(0).max(20),
  instalments: z.coerce.number().int().min(1).max(300),
  startMonth: z.string().refine(isMonth, "validation.invalid"),
  sanctionDate: isoDateField,
  orderNumber: z.string().trim().min(3, "validation.tooShort").max(80),
});

/** Equal principal instalments rounded up to the rupee; the last one recovers only what is left. */
export function instalmentFor(principal: number, instalments: number) {
  return Math.ceil(principal / instalments);
}

const termsOf = loanTermsOf;

export async function listLoans(actor: Actor, opts: { status?: string; employeeId?: string } = {}) {
  if (!canSee(actor)) throw forbidden();
  const loans = await db.loan.findMany({
    where: { boardId: actor.boardId, ...(opts.status && opts.status !== "ALL" ? { status: opts.status as never } : {}), ...(opts.employeeId ? { employeeId: opts.employeeId } : {}) },
    include: { employee: { select: { employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true } }, recoveries: true },
    orderBy: [{ status: "asc" }, { sanctionDate: "desc" }],
  });
  const month = todayIST().slice(0, 7);
  return loans.map((l) => {
    const recovered = l.recoveries.map((r) => ({ month: r.month, principal: num(r.principal), interest: num(r.interest) }));
    const pos = loanPosition(termsOf(l), recovered, month > l.startMonth ? month : l.startMonth);
    return {
      id: l.id,
      type: l.type,
      purpose: l.purpose,
      employeeId: l.employeeId,
      code: l.employee.employeeCode ?? "",
      name: fullName(l.employee),
      nameHi: l.employee.nameHi,
      principal: num(l.principal),
      interestRate: num(l.interestRate),
      instalments: l.instalments,
      instalmentAmount: num(l.instalmentAmount),
      startMonth: l.startMonth,
      status: l.status,
      recoveredPrincipal: recovered.reduce((s, r) => s + r.principal, 0),
      recoveredInterest: recovered.reduce((s, r) => s + r.interest, 0),
      principalLeft: l.status === "CLOSED" ? 0 : pos.principalLeft,
      interestLeft: l.status === "CLOSED" ? 0 : pos.interestLeft,
      closedMonth: l.closedMonth,
    };
  });
}

/** One loan with its schedule and every recovery (and the payroll it came from). */
export async function getLoan(actor: Actor, id: string) {
  if (!canSee(actor)) throw forbidden();
  const l = await db.loan.findFirst({ where: { id, boardId: actor.boardId }, include: { employee: { select: { employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true } }, recoveries: { orderBy: { month: "asc" } } } });
  if (!l) throw notFound();
  const recovered = l.recoveries.map((r) => ({ month: r.month, principal: num(r.principal), interest: num(r.interest) }));
  const month = todayIST().slice(0, 7);
  return {
    loan: { ...l, principal: num(l.principal), interestRate: num(l.interestRate), instalmentAmount: num(l.instalmentAmount), sanctionDate: toISODate(l.sanctionDate), name: fullName(l.employee), code: l.employee.employeeCode ?? "", nameHi: l.employee.nameHi },
    recoveries: l.recoveries.map((r) => ({ id: r.id, month: r.month, principal: num(r.principal), interest: num(r.interest), runId: r.runId })),
    schedule: loanSchedule(termsOf(l)),
    position: loanPosition(termsOf(l), recovered, month > l.startMonth ? month : l.startMonth),
    canSanction: canMake(actor),
  };
}

/** What a loan would look like — shown on the form before it is sent. */
export function previewLoan(raw: unknown) {
  const input = loanSchema.parse(raw);
  const instalmentAmount = instalmentFor(input.principal, input.instalments);
  const schedule = loanSchedule({ principal: input.principal, interestRate: input.interestRate, instalmentAmount, startMonth: input.startMonth });
  const interest = schedule.reduce((s, r) => s + r.interest, 0);
  return { instalmentAmount, months: schedule.length, interest, total: fromPaise(toPaise(input.principal) + toPaise(interest)), lastMonth: schedule.at(-1)?.month ?? input.startMonth };
}

export async function sanctionLoan(actor: Actor, raw: unknown) {
  if (!canMake(actor)) throw forbidden();
  const input = loanSchema.parse(raw);
  if (input.startMonth < todayIST().slice(0, 7)) throw badRequest("errors.validation", { startMonth: "payroll.loans.startPast" });
  const e = await db.employee.findFirst({ where: { id: input.employeeId, boardId: actor.boardId, status: "ACTIVE" } });
  if (!e) throw notFound();
  const p = previewLoan(input);
  return db.$transaction(async (tx) => {
    const loan = await tx.loan.create({
      data: {
        boardId: actor.boardId,
        employeeId: e.id,
        type: input.type,
        purpose: input.purpose ?? null,
        principal: input.principal,
        interestRate: input.interestRate,
        instalments: input.instalments,
        instalmentAmount: p.instalmentAmount,
        sanctionDate: fromISODate(input.sanctionDate),
        orderNumber: input.orderNumber,
        startMonth: input.startMonth,
        createdById: actor.userId,
        createdByName: actor.name,
      },
    });
    await submitForApproval(tx, actor, {
      kind: "loan.sanction",
      title: `Loan (${input.type}) ${formatINR(input.principal)}: ${fullName(e)} (${e.employeeCode})`,
      titleHi: `ऋण (${input.type}) ${formatINR(input.principal)}: ${e.nameHi ?? fullName(e)} (${e.employeeCode})`,
      details: {
        summary: "After the Checker, an Admin approves. Recovery starts in the payroll of the start month and stops at zero.",
        summaryHi: "जाँचकर्ता के बाद एडमिन स्वीकृत करते हैं। वसूली प्रारंभ माह के वेतन से शुरू होकर शून्य पर रुकती है।",
        link: `/payroll/loans/${loan.id}`,
        rows: [
          { label: "Principal", labelHi: "मूलधन", new: formatINR(input.principal) },
          { label: "Interest", labelHi: "ब्याज", new: `${input.interestRate}% a year (simple) — ${formatINR(p.interest)} in all` },
          { label: "Instalments", labelHi: "किस्तें", new: `${input.instalments} × ${formatINR(p.instalmentAmount)} from ${formatMonth(input.startMonth)}; last recovery ${formatMonth(p.lastMonth)}` },
          { label: "Sanction order", labelHi: "स्वीकृति आदेश", new: `${input.orderNumber} dated ${formatDate(input.sanctionDate)}` },
          ...(input.purpose ? [{ label: "Purpose", labelHi: "उद्देश्य", new: input.purpose }] : []),
        ],
      } satisfies ApprovalDetails,
      payload: { loanId: loan.id },
      entityType: "Loan",
      entityId: loan.id,
      subjectEmployeeId: e.id,
    });
    await audit(tx, actor, { action: "SUBMIT", entityType: "Loan", entityId: loan.id, summary: `Loan of ${formatINR(input.principal)} for ${fullName(e)} sent for checking`, sensitive: true });
    return loan;
  });
}

export async function onLoanApproved(tx: Tx, task: ApprovalTask, loanId: string) {
  const loan = await tx.loan.update({ where: { id: loanId }, data: { status: "RUNNING" } });
  await emit(tx, task.boardId, "loan.sanctioned", { type: "Loan", id: loanId }, { employeeId: loan.employeeId, principal: num(loan.principal) });
}

export async function onLoanRejected(tx: Tx, loanId: string) {
  await tx.loan.update({ where: { id: loanId }, data: { status: "REJECTED" } });
}
