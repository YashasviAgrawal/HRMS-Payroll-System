import "server-only";
import type { PayrollRun } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { db, type DbLike, type Tx } from "@/lib/db";
import { toISODate } from "@/lib/dates";
import { formatINR, fromPaise, toPaise } from "@/lib/money";
import { emit } from "@/lib/outbox";
import { settleGpf } from "@/modules/pension/cases";
import type { ComputedSlip, LoanDue } from "./compute";
import { PAY_HEAD_DEFAULTS } from "./head-defaults";
import { billLines, type StatementLine, type StatementTotals } from "./settlement-rules";

/**
 * The settlement bill (a supplementary bill of the person's pay group) built from the approved statement, and what its
 * approval or reopening does to the loans, the GPF account and the settlement. Kept apart from settlement.ts so the
 * payroll stages (run.ts, arrears.ts) can call it without a cycle.
 */
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

/** The parts of a stored statement this file reads (settlement.ts has the full shape). */
interface StoredStatement {
  kind: string;
  lastDay: string;
  lines: StatementLine[];
  totals: StatementTotals;
}

/** OTHER_DUE came with the settlement; a Board set up before it gets it on first use. */
async function ensureSettlementHeads(tx: DbLike, boardId: string) {
  const h = PAY_HEAD_DEFAULTS.find((x) => x.code === "OTHER_DUE")!;
  if (await tx.payHead.findUnique({ where: { boardId_code: { boardId, code: h.code } }, select: { id: true } })) return;
  const last = await tx.payHead.aggregate({ where: { boardId }, _max: { sortOrder: true } });
  await tx.payHead.create({ data: { boardId, code: h.code, name: h.name, nameHi: h.nameHi, kind: h.kind, calc: h.calc, value: 0, postCodes: [], prorate: false, countsForDa: false, taxable: true, accountHead: h.accountHead, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
}

/** The one slip of a settlement bill: the statement's lines under their pay heads; net = dues − recoveries. */
export async function settlementSlip(boardId: string, separationId: string, daysInMonth: number): Promise<{ slip: ComputedSlip; bankHash: string | null }> {
  const sep = await db.separation.findFirst({ where: { id: separationId, boardId }, include: { employee: true } });
  if (!sep?.statement || sep.settlementStatus === "NONE" || sep.settlementStatus === "CHECKING") throw new Error("The settlement is not approved");
  const st = sep.statement as unknown as StoredStatement;
  await ensureSettlementHeads(db, boardId);
  const heads = new Map((await db.payHead.findMany({ where: { boardId } })).map((h) => [h.code, h]));
  const lines = billLines(st.lines, (code) => heads.get(code));
  const sum = (kind: string) => fromPaise(lines.filter((l) => l.kind === kind).reduce((t, l) => t + toPaise(l.amount), 0));
  const gross = sum("EARNING");
  const deductions = sum("DEDUCTION");
  const net = fromPaise(toPaise(gross) - toPaise(deductions));
  if (toPaise(net) !== toPaise(st.totals.net)) throw new Error(`Settlement bill net ${net} differs from the statement ${st.totals.net}`);
  const loans: LoanDue[] = st.lines.filter((l) => l.loan).map((l) => ({ loanId: l.loan!.loanId, principal: l.loan!.principal, interest: l.loan!.interest }));
  const withheld = st.lines.filter((l) => l.slip);
  const e = sep.employee;
  return {
    bankHash: e.bankAccountHash,
    slip: {
      employeeId: e.id,
      sectionId: e.sectionId,
      postId: e.postId,
      payLevel: e.payLevel,
      payCell: e.payCell,
      daysInMonth,
      daysOnRoll: 0,
      lossDays: 0,
      halfPayDays: 0,
      workedDays: null,
      lines,
      gross,
      deductions,
      net,
      employer: sum("EMPLOYER"),
      bankLast4: e.bankAccountLast4,
      ifsc: e.ifsc,
      lastNet: null,
      changePct: null,
      detail: {
        settlement: { separationId: sep.id, kind: st.kind, lastDay: st.lastDay },
        ...(loans.length ? { loans } : {}),
        gpfRefunds: withheld.flatMap((l) => l.slip!.gpfRefunds),
        withheldSlipIds: withheld.map((l) => l.slip!.id),
      },
    },
  };
}

/**
 * The settlement is complete: every loan in it closes (its recovery is recorded by the bill's approval, or here when
 * the dues and the person's repayment covered it), GPF advances still running close (the GPF final payment takes the
 * rest of them), and the settlement is marked settled.
 */
export async function closeSettlement(tx: Tx, sep: { id: string; boardId: string; employeeId: string }, st: StoredStatement, opts: { month: string; recoveredBy?: string }) {
  for (const l of st.lines) {
    if (!l.loan) continue;
    if (opts.recoveredBy) {
      await tx.loanRecovery.upsert({
        where: { loanId_runId: { loanId: l.loan.loanId, runId: opts.recoveredBy } },
        create: { loanId: l.loan.loanId, runId: opts.recoveredBy, month: opts.month, principal: l.loan.principal, interest: l.loan.interest },
        update: { principal: l.loan.principal, interest: l.loan.interest },
      });
    }
    await tx.loan.updateMany({ where: { id: l.loan.loanId, status: "RUNNING" }, data: { status: "CLOSED", closedMonth: opts.month } });
  }
  await tx.gpfAdvance.updateMany({ where: { employeeId: sep.employeeId, kind: "ADVANCE", status: "RUNNING" }, data: { status: "CLOSED", closedMonth: opts.month } });
  await tx.separation.update({ where: { id: sep.id }, data: { settlementStatus: "SETTLED", settledAt: new Date() } });
  await emit(tx, sep.boardId, "separation.settled", { type: "Separation", id: sep.id }, { employeeId: sep.employeeId, month: opts.month });
}

const separationOf = (run: Pick<PayrollRun, "source">) => {
  const src = (run.source ?? {}) as { type?: string; separationId?: string };
  return src.type === "SETTLEMENT" && src.separationId ? src.separationId : null;
};

/** Called when a settlement bill is approved (after the loan recoveries and GPF entries of the bill are recorded). */
export async function onSettlementBillApproved(tx: Tx, run: PayrollRun, actor: { boardId: string; userId: string; name: string }) {
  const id = separationOf(run);
  if (!id) return;
  const sep = await tx.separation.findUniqueOrThrow({ where: { id }, include: { employee: { select: { firstName: true, middleName: true, lastName: true } } } });
  const st = sep.statement as unknown as StoredStatement;
  // The GPF account closes with the bill (it may carry subscriptions from withheld pay released in it).
  await settleGpf(tx, sep.employeeId, null, actor.userId, run.id);
  await closeSettlement(tx, sep, st, { month: run.month });
  const name = [sep.employee.firstName, sep.employee.middleName, sep.employee.lastName].filter(Boolean).join(" ");
  await audit(tx, actor, { action: "UPDATE", entityType: "Separation", entityId: id, summary: `Full and final settlement of ${name} paid by the approved bill (net ${formatINR(num(run.net))}); loans closed`, sensitive: true });
}

/** Reopening a settlement bill (PR-13) undoes the settlement; the loans and GPF entries are taken back by run.ts. */
export async function onSettlementBillReopened(tx: Tx, run: PayrollRun) {
  const id = separationOf(run);
  if (!id) return;
  const sep = await tx.separation.findUniqueOrThrow({ where: { id } });
  await tx.separation.update({ where: { id }, data: { settlementStatus: "APPROVED", settledAt: null } });
  // GPF advances the settlement closed (not repaid in full) run again until it is approved once more.
  const closed = await tx.gpfAdvance.findMany({ where: { employeeId: sep.employeeId, kind: "ADVANCE", status: "CLOSED", closedMonth: run.month }, include: { entries: { where: { kind: "REFUND" }, select: { amount: true } } } });
  for (const a of closed) {
    if (a.entries.reduce((t, x) => t + num(x.amount), 0) < num(a.amount)) await tx.gpfAdvance.update({ where: { id: a.id }, data: { status: "RUNNING", closedMonth: null } });
  }
  await emit(tx, run.boardId, "separation.unsettled", { type: "Separation", id }, { runId: run.id, lastDay: sep.effectiveDate ? toISODate(sep.effectiveDate) : null });
}
