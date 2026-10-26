import "server-only";
import type { LeaveType } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { db, type DbLike } from "@/lib/db";
import { fromISODate, maxDate, todayIST, toISODate } from "@/lib/dates";
import { emit } from "@/lib/outbox";
import { cappedCredit, creditPeriod, hasBalance, isEligible, periodCredit, type LeaveRule } from "./rules";

export type LeaveTypeRow = LeaveRule & Pick<LeaveType, "id" | "name" | "nameHi" | "sortOrder" | "isActive" | "version">;

export function toRule(t: LeaveType): LeaveTypeRow {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    nameHi: t.nameHi,
    pay: t.pay,
    creditMode: t.creditMode,
    creditDays: Number(t.creditDays),
    cap: t.cap === null ? null : Number(t.cap),
    lapsesAtYearEnd: t.lapsesAtYearEnd,
    debitFrom: t.debitFrom,
    debitFactor: Number(t.debitFactor),
    countsOffDays: t.countsOffDays,
    halfDayAllowed: t.halfDayAllowed,
    needsCertificate: t.needsCertificate,
    restrictedOnly: t.restrictedOnly,
    gender: t.gender,
    employeeTypes: t.employeeTypes,
    officerLimitDays: t.officerLimitDays,
    sortOrder: t.sortOrder,
    isActive: t.isActive,
    version: t.version,
  };
}

/** The Board's leave rules table, in display order. */
export async function leaveRules(boardId: string, tx: DbLike = db): Promise<LeaveTypeRow[]> {
  const rows = await tx.leaveType.findMany({ where: { boardId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  return rows.map(toRule);
}

/** Balance per leave code from the ledger (credits − debits). */
export async function ledgerBalances(employeeId: string, tx: DbLike = db): Promise<Map<string, number>> {
  const rows = await tx.leaveLedger.groupBy({ by: ["leaveCode"], where: { employeeId }, _sum: { days: true } });
  return new Map(rows.map((r) => [r.leaveCode, Number(r._sum.days ?? 0)]));
}

/** Days already asked for and waiting, per balance they will come from. */
export async function pendingDebits(employeeId: string, tx: DbLike = db, exceptId?: string): Promise<Map<string, number>> {
  const rows = await tx.leaveApplication.groupBy({ by: ["debitCode"], where: { employeeId, status: "PENDING", ...(exceptId ? { id: { not: exceptId } } : {}) }, _sum: { debitDays: true } });
  return new Map(rows.map((r) => [r.debitCode, Number(r._sum.debitDays ?? 0)]));
}

/**
 * Days of a leave used in the whole service (CCL): applications approved or waiting, plus what was already used
 * before the system (the opening entry of a service-limited leave records days used).
 */
export async function usedInService(employeeId: string, code: string, tx: DbLike = db, exceptId?: string): Promise<number> {
  const [r, opening] = await Promise.all([
    tx.leaveApplication.aggregate({ where: { employeeId, leaveCode: code, status: { in: ["APPROVED", "PENDING"] }, ...(exceptId ? { id: { not: exceptId } } : {}) }, _sum: { days: true } }),
    tx.leaveLedger.aggregate({ where: { employeeId, leaveCode: code, kind: "OPENING" }, _sum: { days: true } }),
  ]);
  return Number(r._sum.days ?? 0) + Number(opening._sum.days ?? 0);
}

export interface BalanceView {
  code: string;
  name: string;
  nameHi: string;
  pay: LeaveRule["pay"];
  creditMode: LeaveRule["creditMode"];
  /** Ledger balance for credited leave; what is left for service-limited leave; the per-spell limit for spell leave. */
  balance: number | null;
  pending: number;
  /** Balance less what is waiting. Null when there is no limit (EOL) or it comes from another balance. */
  available: number | null;
  debitFrom: string | null;
}

/** Leave this person may take, with balances (S-31). */
export async function balancesFor(employee: { id: string; gender: string; type: LeaveRule["employeeTypes"][number] }, boardId: string, tx: DbLike = db): Promise<BalanceView[]> {
  const [rules, ledger, pending] = await Promise.all([leaveRules(boardId, tx), ledgerBalances(employee.id, tx), pendingDebits(employee.id, tx)]);
  const out: BalanceView[] = [];
  for (const r of rules) {
    if (!r.isActive || !isEligible(r, employee)) continue;
    const p = pending.get(r.code) ?? 0;
    let balance: number | null = null;
    if (hasBalance(r)) balance = ledger.get(r.code) ?? 0;
    else if (r.creditMode === "SERVICE") balance = r.creditDays - (await usedInService(employee.id, r.code, tx));
    else if (r.creditMode === "SPELL") balance = r.creditDays;
    out.push({
      code: r.code,
      name: r.name,
      nameHi: r.nameHi,
      pay: r.pay,
      creditMode: r.creditMode,
      balance,
      pending: p,
      available: balance === null ? null : r.creditMode === "SERVICE" || r.creditMode === "SPELL" ? balance : balance - p,
      debitFrom: r.debitFrom,
    });
  }
  return out;
}

const ensured = new Map<string, string>();

/**
 * LV-02: EL and HPL on 1 January and 1 July, CL and RH on 1 January (what is left of last year lapses first).
 * Runs at most once a day per Board, the first time leave is looked at; a per-person, per-period ledger key
 * makes it safe to run twice. New joiners get their pro-rata credit the same way.
 */
export async function ensureCredits(boardId: string, today: string = todayIST()) {
  if (ensured.get(boardId) === today) return;
  const rules = (await leaveRules(boardId)).filter((r) => r.isActive && hasBalance(r));
  const employees = await db.employee.findMany({
    where: { boardId, employeeCode: { not: null }, status: { in: ["ACTIVE", "SUSPENDED"] } },
    select: { id: true, gender: true, type: true, dateOfJoining: true },
  });
  let credited = 0;
  for (const r of rules) {
    const period = creditPeriod(r.creditMode as "HALF_YEARLY" | "YEARLY", today);
    const done = new Set((await db.leaveLedger.findMany({ where: { boardId, leaveCode: r.code, period: period.id }, select: { employeeId: true } })).map((x) => x.employeeId));
    for (const e of employees) {
      const doj = toISODate(e.dateOfJoining);
      if (done.has(e.id) || doj > period.end || !isEligible(r, e)) continue;
      try {
        await db.$transaction(async (tx) => {
          if (r.lapsesAtYearEnd) {
            const lastYear = String(Number(period.start.slice(0, 4)) - 1);
            const before = await tx.leaveLedger.aggregate({ where: { employeeId: e.id, leaveCode: r.code, date: { lt: fromISODate(period.start) } }, _sum: { days: true } });
            const left = Number(before._sum.days ?? 0);
            if (left > 0) {
              await tx.leaveLedger.create({ data: { boardId, employeeId: e.id, leaveCode: r.code, date: fromISODate(`${lastYear}-12-31`), kind: "LAPSE", days: -left, period: `lapse-${lastYear}`, note: `Unused ${r.code} of ${lastYear} lapsed` } });
            }
          }
          const balance = Number((await tx.leaveLedger.aggregate({ where: { employeeId: e.id, leaveCode: r.code }, _sum: { days: true } }))._sum.days ?? 0);
          const due = periodCredit(r, doj, period);
          const credit = cappedCredit(due, balance, r.cap);
          await tx.leaveLedger.create({
            data: {
              boardId,
              employeeId: e.id,
              leaveCode: r.code,
              date: fromISODate(maxDate(period.start, doj)),
              kind: "CREDIT",
              days: credit,
              period: period.id,
              note: credit < due ? `Credit limited by the cap of ${r.cap} days` : doj > period.start ? `Pro-rata credit from joining on ${doj}` : `Credit for ${period.id}`,
            },
          });
        });
        credited += 1;
      } catch (err) {
        // Another request credited the same person at the same moment: the unique key stopped a double credit.
        if (!(err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002")) throw err;
      }
    }
  }
  if (credited > 0) {
    await audit(db, { boardId, name: "System (leave credit)" }, { action: "CREDIT", entityType: "LeaveLedger", summary: `Leave credited: ${credited} credits on ${today}`, category: "DATA" });
    await emit(db, boardId, "leave.credited", { type: "LeaveLedger", id: today }, { credits: credited });
  }
  ensured.set(boardId, today);
}

/** For tests: forget that today's credits were checked. */
export function resetCreditCheck() {
  ensured.clear();
}
