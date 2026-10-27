/**
 * PN-08: the facts a pension case is worked out from, read from the records — the service book dates, the pay on the
 * last day and the last ten months' pay bills, leave without pay and dies-non (not qualifying service), the earned leave
 * balance, the GPF account with this year's interest, the rates in force on the last day and the commutation table in
 * force the day after. No "server-only": the seed uses it.
 */
import type { DbLike } from "@/lib/db";
import { addDays, fromISODate, shiftMonth, toISODate, type ISODate } from "@/lib/dates";
import { basicFrom, matrixOn, ratesOn } from "@/modules/payroll/compute";
import type { PayLine } from "@/modules/payroll/engine";
import { gpfBalance, gpfYear, type GpfMove } from "@/modules/statutory/gpf-rules";
import { fyOfMonth } from "@/modules/statutory/tax-rules";
import { COMMUTATION_FACTORS_2008, type CaseFacts, type CaseType } from "./calculator";

const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;

/** What the records gave, shown beside the working so the Checker can see where each figure came from. */
export interface CaseSources {
  scheme: "OPS" | "NPS";
  basic: number;
  npa: number;
  /** Pay (Basic + NPA) of each of the last ten months: from the approved pay bill, or the pay on the last day. */
  tenMonths: { month: string; pay: number; fromBill: boolean }[];
  eolDays: number;
  diesNonDays: number;
  elDays: number;
  gpf: { balance: number; interest: number };
  daPercent: number;
  factorsFrom: ISODate | null;
}

/** The commutation table in force on a date (an editable dated table; the 2008 table until the Board loads another). */
export async function commutationFactorsOn(tx: DbLike, boardId: string, date: ISODate): Promise<{ factors: Record<string, number>; from: ISODate | null }> {
  const t = await tx.ruleTable.findFirst({ where: { boardId, code: "COMMUTATION_FACTORS", effectiveFrom: { lte: fromISODate(date) } }, orderBy: { effectiveFrom: "desc" } });
  return t ? { factors: t.data as Record<string, number>, from: toISODate(t.effectiveFrom) } : { factors: COMMUTATION_FACTORS_2008, from: null };
}

/** GPF final payment: the balance, and this year's interest to the month of retirement not yet credited (OPS staff). */
export async function gpfFinal(tx: DbLike, boardId: string, employeeId: string, lastMonth: string): Promise<{ balance: number; interest: number; fy: string }> {
  const [rows, rateRows] = await Promise.all([
    tx.gpfEntry.findMany({ where: { employeeId }, orderBy: [{ month: "asc" }, { createdAt: "asc" }] }),
    tx.payRate.findMany({ where: { boardId, key: "GPF_INTEREST" }, orderBy: { effectiveFrom: "asc" } }),
  ]);
  const fy = fyOfMonth(lastMonth);
  if (!rows.length) return { balance: 0, interest: 0, fy };
  const moves: GpfMove[] = rows.map((r) => ({ month: r.month, fy: r.fy, kind: r.kind, amount: num(r.amount) }));
  const rateFor = (month: string) => {
    let v = 0;
    for (const r of rateRows) if (toISODate(r.effectiveFrom) <= `${month}-01`) v = num(r.value);
    return v;
  };
  const year = gpfYear(moves, fy, rateFor, lastMonth);
  return { balance: gpfBalance(moves), interest: Math.max(0, year.interest - year.interestCredited), fy };
}

export async function caseFactsFor(
  tx: DbLike,
  boardId: string,
  employeeId: string,
  input: { type: CaseType; lastDay: ISODate; commutationPct: number; nonQualifyingDays?: number | null },
): Promise<{ facts: CaseFacts; sources: CaseSources }> {
  const e = await tx.employee.findFirstOrThrow({ where: { id: employeeId, boardId }, include: { post: true } });
  const scheme = e.type === "PERMANENT_OPS" ? "OPS" : "NPS";
  const pensionFrom = addDays(input.lastDay, 1);
  const lastMonth = input.lastDay.slice(0, 7);
  const [rates, matrix, npaHead, slips, eol, diesNon, el, gpfNow, table] = await Promise.all([
    ratesOn(boardId, input.lastDay, tx),
    matrixOn(boardId, input.lastDay, tx),
    tx.payHead.findUnique({ where: { boardId_code: { boardId, code: "NPA" } } }),
    tx.payslip.findMany({
      where: { employeeId, pensionerId: null, status: "INCLUDED", month: { gte: shiftMonth(lastMonth, -9), lte: lastMonth }, run: { kind: "REGULAR", status: { in: [...PAID] } } },
      select: { month: true, lines: true },
    }),
    tx.leaveApplication.aggregate({ where: { employeeId, leaveCode: "EOL", status: "APPROVED", fromDate: { lte: fromISODate(input.lastDay) } }, _sum: { days: true } }),
    tx.attendanceDay.findMany({ where: { employeeId, status: "DIES_NON", date: { lte: fromISODate(input.lastDay) } }, select: { half: true } }),
    tx.leaveLedger.aggregate({ where: { employeeId, leaveCode: "EL" }, _sum: { days: true } }),
    gpfFinal(tx, boardId, employeeId, lastMonth),
    commutationFactorsOn(tx, boardId, pensionFrom),
  ]);
  const basic = basicFrom(matrix?.levels, e.payLevel, e.payCell) ?? 0;
  const npa = npaHead && npaHead.isActive && npaHead.postCodes.includes(e.post.code) ? Math.round((basic * num(npaHead.value)) / 100) : 0;
  const lastPay = basic + npa;
  const tenMonths: CaseSources["tenMonths"] = [];
  for (let i = 9; i >= 0; i--) {
    const month = shiftMonth(lastMonth, -i);
    const slip = slips.find((s) => s.month === month);
    const pay = slip ? (slip.lines as unknown as PayLine[]).filter((l) => l.code === "BASIC" || l.code === "NPA").reduce((s, l) => s + l.amount, 0) : 0;
    tenMonths.push(slip && pay > 0 ? { month, pay, fromBill: true } : { month, pay: lastPay, fromBill: false });
  }
  const averagePay = Math.round(tenMonths.reduce((s, m) => s + m.pay, 0) / 10);
  const eolDays = num(eol._sum.days);
  const diesNonDays = diesNon.reduce((s, d) => s + (d.half ? 0.5 : 1), 0);
  const elDays = Math.max(0, num(el._sum.days));
  // GPF final payment: the balance with this year's interest to the month of retirement (OPS staff only).
  const gpf = scheme === "OPS" ? { balance: gpfNow.balance, interest: gpfNow.interest } : { balance: 0, interest: 0 };
  const nonQualifyingDays = input.nonQualifyingDays ?? Math.round(eolDays + diesNonDays);
  return {
    facts: {
      type: input.type,
      scheme,
      dob: toISODate(e.dateOfBirth),
      doj: toISODate(e.dateOfJoining),
      retirementDate: input.lastDay,
      nonQualifyingDays,
      lastPay,
      averagePay,
      daPercent: rates.DA_PERCENT ?? 0,
      elDays,
      gpfBalance: gpf.balance + gpf.interest,
      commutationPct: input.commutationPct,
      rates,
      factors: table.factors,
    },
    sources: { scheme, basic, npa, tenMonths, eolDays, diesNonDays, elDays, gpf, daPercent: rates.DA_PERCENT ?? 0, factorsFrom: table.from },
  };
}
