/**
 * GPF entries from the payroll (§9): an approved pay bill credits each subscription and each advance instalment to the
 * GPF account; reopening the bill (PR-13) takes them back out. No "server-only": the demo seed posts its history too.
 */
import type { DbLike, Tx } from "@/lib/db";
import type { PayLine } from "@/modules/payroll/engine";
import { fyOfMonth } from "./tax-rules";
import { gpfRefundDue } from "./gpf-rules";

const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

export interface GpfRefund {
  advanceId: string;
  amount: number;
}

/** What each running GPF advance recovers in a month, from the instalments credited by earlier months' pay bills. */
export async function gpfRefundsDue(tx: DbLike, employeeIds: string[], month: string) {
  const advances = await tx.gpfAdvance.findMany({
    where: { employeeId: { in: employeeIds }, kind: "ADVANCE", status: "RUNNING", startMonth: { lte: month } },
    include: { entries: { where: { kind: "REFUND", month: { lt: month } }, select: { amount: true } } },
    orderBy: { sanctionDate: "asc" },
  });
  const out = new Map<string, GpfRefund[]>();
  for (const a of advances) {
    const recovered = a.entries.reduce((s, e) => s + num(e.amount), 0);
    const amount = gpfRefundDue(num(a.amount), num(a.instalmentAmount), recovered);
    if (amount <= 0) continue;
    out.set(a.employeeId, [...(out.get(a.employeeId) ?? []), { advanceId: a.id, amount }]);
  }
  return out;
}

/** An approved pay bill credits the GPF subscriptions and advance instalments it deducted; a repaid advance closes. */
export async function recordGpf(tx: Tx, runId: string, createdById?: string) {
  const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId } });
  const slips = await tx.payslip.findMany({ where: { runId, status: "INCLUDED" }, select: { employeeId: true, lines: true, detail: true } });
  const fy = fyOfMonth(run.month);
  const rows: { boardId: string; employeeId: string; month: string; fy: string; kind: "SUBSCRIPTION" | "REFUND"; amount: number; runId: string; advanceId?: string; createdById?: string }[] = [];
  const touched = new Set<string>();
  for (const s of slips) {
    const gpf = (s.lines as unknown as PayLine[]).find((l) => l.code === "GPF")?.amount ?? 0;
    if (gpf > 0) rows.push({ boardId: run.boardId, employeeId: s.employeeId, month: run.month, fy, kind: "SUBSCRIPTION", amount: gpf, runId, createdById });
    for (const r of ((s.detail as { gpfRefunds?: GpfRefund[] } | null)?.gpfRefunds ?? [])) {
      rows.push({ boardId: run.boardId, employeeId: s.employeeId, month: run.month, fy, kind: "REFUND", amount: r.amount, runId, advanceId: r.advanceId, createdById });
      touched.add(r.advanceId);
    }
  }
  await tx.gpfEntry.deleteMany({ where: { runId } });
  if (rows.length) await tx.gpfEntry.createMany({ data: rows });
  for (const id of touched) {
    const a = await tx.gpfAdvance.findUniqueOrThrow({ where: { id }, include: { entries: { where: { kind: "REFUND" }, select: { amount: true } } } });
    const recovered = a.entries.reduce((s, e) => s + num(e.amount), 0);
    if (recovered >= num(a.amount) && a.status === "RUNNING") await tx.gpfAdvance.update({ where: { id }, data: { status: "CLOSED", closedMonth: run.month } });
  }
  return rows.length;
}

/** Reopening a pay bill takes its GPF entries back out; an advance it had closed runs again. */
export async function undoGpf(tx: Tx, runId: string) {
  const refunds = await tx.gpfEntry.findMany({ where: { runId, kind: "REFUND", advanceId: { not: null } }, select: { advanceId: true } });
  await tx.gpfEntry.deleteMany({ where: { runId } });
  const ids = [...new Set(refunds.map((r) => r.advanceId!))];
  if (ids.length) await tx.gpfAdvance.updateMany({ where: { id: { in: ids }, status: "CLOSED", kind: "ADVANCE" }, data: { status: "RUNNING", closedMonth: null } });
}
