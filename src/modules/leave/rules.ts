/**
 * Leave rules as pure functions (PRD §7): counting days, credit periods and pro-rata credits for new joiners.
 */
import type { EmployeeType, LeaveCreditMode, LeavePay } from "@/generated/prisma/enums";
import { addDays, daysBetweenInclusive, weekday, type ISODate } from "@/lib/dates";

export interface LeaveRule {
  code: string;
  pay: LeavePay;
  creditMode: LeaveCreditMode;
  creditDays: number;
  cap: number | null;
  lapsesAtYearEnd: boolean;
  debitFrom: string | null;
  debitFactor: number;
  countsOffDays: boolean;
  halfDayAllowed: boolean;
  needsCertificate: boolean;
  restrictedOnly: boolean;
  gender: string | null;
  employeeTypes: EmployeeType[];
  officerLimitDays: number | null;
}

/** Types that keep a balance in the ledger. */
export const hasBalance = (r: Pick<LeaveRule, "creditMode">) => r.creditMode === "HALF_YEARLY" || r.creditMode === "YEARLY";

export function isEligible(r: Pick<LeaveRule, "gender" | "employeeTypes">, e: { gender: string; type: EmployeeType }) {
  return r.employeeTypes.includes(e.type) && (!r.gender || r.gender === e.gender);
}

/**
 * Days of leave between two dates. CL (countsOffDays = false) skips holidays and weekly offs inside the leave;
 * other leave counts every calendar day. A half day is allowed only for a single day of a type that permits it.
 */
export function countLeaveDays(input: { from: ISODate; to: ISODate; halfDay: boolean; countsOffDays: boolean; holidays: Set<ISODate>; weeklyOff: number[] }): number {
  if (input.to < input.from) return 0;
  if (input.halfDay) return input.from === input.to && (input.countsOffDays || isWorking(input.from, input)) ? 0.5 : 0;
  if (input.countsOffDays) return daysBetweenInclusive(input.from, input.to);
  let n = 0;
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) if (isWorking(d, input)) n += 1;
  return n;
}

function isWorking(d: ISODate, c: { holidays: Set<ISODate>; weeklyOff: number[] }) {
  return !c.holidays.has(d) && !c.weeklyOff.includes(weekday(d));
}

/** The dates a leave marks in attendance: every day, or only working days for CL-like leave. */
export function leaveDates(input: { from: ISODate; to: ISODate; countsOffDays: boolean; holidays: Set<ISODate>; weeklyOff: number[] }): ISODate[] {
  const out: ISODate[] = [];
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) if (input.countsOffDays || isWorking(d, input)) out.push(d);
  return out;
}

export interface CreditPeriod {
  id: string;
  start: ISODate;
  end: ISODate;
}

/** The credit period containing a date: half-years for EL/HPL, the calendar year for CL/RH. */
export function creditPeriod(mode: "HALF_YEARLY" | "YEARLY", on: ISODate): CreditPeriod {
  const y = on.slice(0, 4);
  if (mode === "YEARLY") return { id: y, start: `${y}-01-01`, end: `${y}-12-31` };
  const h2 = on.slice(5, 7) >= "07";
  return h2 ? { id: `${y}-H2`, start: `${y}-07-01`, end: `${y}-12-31` } : { id: `${y}-H1`, start: `${y}-01-01`, end: `${y}-06-30` };
}

/**
 * Credit for a period. Someone on the rolls at its start gets the full credit; someone who joined during it gets
 * the credit for each completed calendar month left in the period (EL 2½ days a month), rounded to whole days
 * with half a day and more going up. Restricted holidays are never pro-rated.
 */
export function periodCredit(r: Pick<LeaveRule, "creditMode" | "creditDays" | "restrictedOnly">, doj: ISODate, period: CreditPeriod): number {
  if (doj <= period.start || r.restrictedOnly) return r.creditDays;
  if (doj > period.end) return 0;
  const months = r.creditMode === "YEARLY" ? 12 : 6;
  const [jy, jm, jd] = doj.split("-").map(Number);
  const [ey, em] = period.end.split("-").map(Number);
  // The joining month counts only when joined on the 1st.
  const firstFull = jd === 1 ? jy * 12 + jm : jy * 12 + jm + 1;
  const completed = Math.max(0, ey * 12 + em - firstFull + 1);
  return Math.floor((r.creditDays * completed) / months + 0.5);
}

/** EL is capped (300): a credit never takes the balance above the cap. */
export function cappedCredit(credit: number, balance: number, cap: number | null) {
  if (cap === null) return credit;
  return Math.max(0, Math.min(credit, cap - balance));
}

/**
 * Who decides an application: the section's reporting officer within their limit; an Admin beyond it, for
 * leave the officer cannot sanction, and for an officer's own leave.
 */
export function deciderFor(r: Pick<LeaveRule, "officerLimitDays">, days: number, hasOfficer: boolean): "REPORTING_OFFICER" | "APPROVER" {
  if (!hasOfficer || r.officerLimitDays === null || days > r.officerLimitDays) return "APPROVER";
  return "REPORTING_OFFICER";
}
