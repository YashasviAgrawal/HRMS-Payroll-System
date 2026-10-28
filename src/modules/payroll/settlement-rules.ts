/**
 * Client add-on: the full and final settlement on leaving service (resignation, removal, dismissal, termination, end of
 * contract, transfer out) as pure rules — shared by the service, the screens and the tests. Retirement and death have
 * their own flows (pension cases). The leave rules follow the CCS (Leave) Rules 1972 and are marked "to confirm for DCB";
 * the Payroll clerk can change the days for a case, with the order in hand.
 */
import { datesOfMonth, shiftMonth, type ISODate } from "@/lib/dates";
import { fromPaise, roundPaiseToRupee, toPaise } from "@/lib/money";
import type { PayLine } from "./engine";

export const EXIT_KINDS = ["RESIGNATION", "REMOVAL", "DISMISSAL", "TERMINATION", "CONTRACT_END", "TRANSFER_OUT"] as const;
export type ExitKind = (typeof EXIT_KINDS)[number];
export const SEPARATION_KINDS = ["SUSPENSION", ...EXIT_KINDS] as const;
export type SeparationKind = (typeof SEPARATION_KINDS)[number];

export const isExit = (kind: string): kind is ExitKind => (EXIT_KINDS as readonly string[]).includes(kind);

/** The employee status each kind leaves the person in. */
export const STATUS_AFTER: Record<SeparationKind, "SUSPENDED" | "RESIGNED" | "TERMINATED" | "TRANSFERRED"> = {
  SUSPENSION: "SUSPENDED",
  RESIGNATION: "RESIGNED",
  REMOVAL: "TERMINATED",
  DISMISSAL: "TERMINATED",
  TERMINATION: "TERMINATED",
  CONTRACT_END: "TERMINATED",
  TRANSFER_OUT: "TRANSFERRED",
};

/**
 * Earned leave paid in cash on leaving (CCS (Leave) Rules r. 39): half the balance up to 150 days on resignation, the
 * balance up to 300 days when the service is terminated; none on removal or dismissal (the leave lapses, r. 9), at the
 * end of a contract, or on transfer out (the balance goes with the person). To confirm for DCB.
 */
export const LEAVE_ON_LEAVING: Record<ExitKind, { share: number; maxDays: number }> = {
  RESIGNATION: { share: 0.5, maxDays: 150 },
  TERMINATION: { share: 1, maxDays: 300 },
  REMOVAL: { share: 0, maxDays: 0 },
  DISMISSAL: { share: 0, maxDays: 0 },
  CONTRACT_END: { share: 0, maxDays: 0 },
  TRANSFER_OUT: { share: 0, maxDays: 0 },
};

/** Days of earned leave paid for a kind of leaving, in whole and half days (rounded down). */
export function encashableDays(kind: ExitKind, elBalance: number): number {
  const rule = LEAVE_ON_LEAVING[kind];
  if (rule.share <= 0 || elBalance <= 0) return 0;
  return Math.min(rule.maxDays, Math.floor(elBalance * rule.share * 2) / 2);
}

const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));

/**
 * Earned leave is credited in advance for each half-year; someone who leaves during it earns only 2½ days for each
 * completed calendar month of service in it (CCS (Leave) r. 27). Returns the days of this half-year's credit not
 * earned — taken off the balance before it is paid. The month of leaving counts only when the last day is its end.
 */
export function elNotEarned(credit: { days: number; periodStart: ISODate; periodEnd: ISODate; fullCredit: number }, doj: ISODate, lastDay: ISODate): number {
  if (credit.days <= 0 || lastDay >= credit.periodEnd || lastDay < credit.periodStart) return 0;
  const months = monthIndex(credit.periodEnd) - monthIndex(credit.periodStart) + 1;
  const joinedIn = doj > credit.periodStart;
  const first = joinedIn ? monthIndex(doj) + (doj.endsWith("-01") ? 0 : 1) : monthIndex(credit.periodStart);
  const leftAtMonthEnd = datesOfMonth(lastDay.slice(0, 7)).at(-1) === lastDay;
  const last = monthIndex(lastDay) - (leftAtMonthEnd ? 0 : 1);
  const completed = Math.max(0, last - first + 1);
  const earned = Math.floor((credit.fullCredit * completed) / months + 0.5);
  return Math.max(0, credit.days - earned);
}

/** Leave encashment: days × (pay + NPA with DA, to the rupee) ÷ 30, as for retirement (calculator.ts). */
export function leaveEncashment(days: number, pay: number, daPercent: number): { withDa: number; amount: number } {
  const withDa = Math.round(pay * (1 + daPercent / 100));
  return { withDa, amount: Math.round((days * withDa) / 30) };
}

/**
 * Pay drawn for days after the last day in an approved regular bill, recovered on leaving: in the month of leaving
 * the days after the last day; every later month in full. Worked on the net pay of the slip, to the rupee.
 */
export function paidBeyond(slip: { month: string; net: number; daysOnRoll: number; daysInMonth: number }, lastDay: ISODate): { days: number; amount: number } {
  const lastMonth = lastDay.slice(0, 7);
  if (slip.month < lastMonth || slip.net <= 0) return { days: 0, amount: 0 };
  const paidDays = slip.daysOnRoll || slip.daysInMonth;
  const beyond = slip.month === lastMonth ? Math.max(0, paidDays - Number(lastDay.slice(8, 10))) : paidDays;
  if (beyond <= 0) return { days: 0, amount: 0 };
  return { days: beyond, amount: fromPaise(roundPaiseToRupee((toPaise(slip.net) * beyond) / paidDays)) };
}

/** What is left of a monthly recovery with an end month (overpayment, society dues …) after the month of leaving. */
export function instalmentsLeft(item: { amount: number; fromMonth: string; toMonth: string | null }, lastMonth: string): { months: number; amount: number } {
  if (!item.toMonth || item.amount <= 0) return { months: 0, amount: 0 };
  const after = shiftMonth(lastMonth, 1);
  const start = item.fromMonth > after ? item.fromMonth : after;
  if (start > item.toMonth) return { months: 0, amount: 0 };
  const months = monthIndex(`${item.toMonth}-01`) - monthIndex(`${start}-01`) + 1;
  return { months, amount: fromPaise(toPaise(item.amount) * months) };
}

/** A slip's lines for part of a month (a withheld slip that paid days after the last day), each head to the rupee. */
export function scaleLines(lines: PayLine[], factor: number): PayLine[] {
  if (factor >= 1) return lines;
  return lines.map((l) => ({ ...l, amount: fromPaise(roundPaiseToRupee(toPaise(l.amount) * factor)) })).filter((l) => l.amount !== 0);
}

/** Withheld pay due: the slip's earnings less its own deductions other than the loan instalment (loans are settled whole). */
export function withheldDue(lines: PayLine[]): number {
  let paise = 0;
  for (const l of lines) {
    if (l.kind === "EARNING") paise += toPaise(l.amount);
    else if (l.kind === "DEDUCTION" && l.code !== "LOAN") paise -= toPaise(l.amount);
  }
  return fromPaise(paise);
}

// ─── The statement ────────────────────────────────────────────────────────────

export type LineSource = "WITHHELD" | "LEAVE" | "MANUAL" | "LOAN" | "OVERPAID" | "ITEM";

export interface StatementLine {
  key: string;
  kind: "DUE" | "RECOVERY";
  source: LineSource;
  label: string;
  labelHi: string;
  note?: string;
  noteHi?: string;
  amount: number;
  /** The pay head the settlement bill pays or recovers it under. */
  headCode: string;
  loan?: { loanId: string; principal: number; interest: number };
  /** Withheld pay released: the slip, its lines (the loan instalment left out) and the GPF advance instalments in it. */
  slip?: { id: string; month: string; lines: PayLine[]; gpfRefunds: { advanceId: string; amount: number }[] };
}

export interface StatementTotals {
  dues: number;
  recoveries: number;
  /** Dues less recoveries. */
  net: number;
  /** Paid to the person by the settlement bill. */
  payable: number;
  /** Still to be paid back by the person. */
  toRecover: number;
}

export function totalsOf(lines: Pick<StatementLine, "kind" | "amount">[]): StatementTotals {
  const dues = lines.filter((l) => l.kind === "DUE").reduce((s, l) => s + toPaise(l.amount), 0);
  const recoveries = lines.filter((l) => l.kind === "RECOVERY").reduce((s, l) => s + toPaise(l.amount), 0);
  const net = dues - recoveries;
  return { dues: fromPaise(dues), recoveries: fromPaise(recoveries), net: fromPaise(net), payable: fromPaise(Math.max(0, net)), toRecover: fromPaise(Math.max(0, -net)) };
}

export interface HeadInfo {
  name: string;
  nameHi: string;
  kind: PayLine["kind"];
  accountHead: string;
}

/**
 * The settlement bill's pay lines from a statement: the released withheld slips' own lines (their loan instalments
 * left out), leave encashment, other dues, every loan in one LOAN line, overpaid pay and recoveries entered by hand
 * under RECOVERY, and each standing recovery under its own head. Earnings less deductions equal the statement's net.
 */
export function billLines(lines: StatementLine[], headOf: (code: string) => HeadInfo | undefined): PayLine[] {
  const out = new Map<string, PayLine>();
  const add = (code: string, amount: number, fallback?: Pick<PayLine, "name" | "nameHi" | "kind" | "accountHead">) => {
    if (amount === 0) return;
    const h = headOf(code) ?? fallback;
    if (!h) throw new Error(`Pay head ${code} is missing`);
    const line = out.get(code) ?? { code, name: h.name, nameHi: h.nameHi, kind: h.kind, amount: 0, accountHead: h.accountHead };
    line.amount = fromPaise(toPaise(line.amount) + toPaise(amount));
    out.set(code, line);
  };
  for (const l of lines) {
    if (l.source === "WITHHELD" && l.slip) {
      for (const p of l.slip.lines) if (p.code !== "LOAN") add(p.code, p.amount, p);
    } else {
      add(l.headCode, l.amount);
    }
  }
  return [...out.values()].filter((l) => l.amount !== 0);
}
