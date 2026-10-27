/**
 * Pension as pure rules (PRD §10) — the pension bill, arrears, the pensioner's screens, the seed and the tests share them.
 *
 * A month's pension (PN-02): basic pension (or family pension, at the enhanced rate until its date and the normal rate
 * after) + additional pension from age 80 (PN-04, from the 1st of the month the pensioner reaches each slab) + dearness
 * relief at the staff DA rate on basic + additional pension + fixed medical allowance, less the commuted part until it
 * is restored 15 years after commutation (PN-03). Each head is worked out in paise and rounded to the rupee. A part
 * month (start, end, a change of rate) is paid by days.
 */
import type { PayHeadKind } from "@/generated/prisma/enums";
import { addDays, datesOfMonth, endOfMonth, type ISODate } from "@/lib/dates";
import { fromPaise, percentOf, roundPaiseToRupee, toPaise } from "@/lib/money";
import type { PayLine, PayResult } from "@/modules/payroll/engine";

export interface PensionFacts {
  type: string;
  basicPension: number;
  reducedPension: number | null;
  reducedFrom: ISODate | null;
  commutedAmount: number;
  commutationDate: ISODate | null;
  payeeDob: ISODate;
  fmaEligible: boolean;
  startDate: ISODate;
  endDate: ISODate | null;
}

export interface PensionHead {
  code: string;
  name: string;
  nameHi: string;
  kind: PayHeadKind;
  accountHead: string;
}

/** Names of the kinds of pension, in English and Hindi. */
export const PENSION_TYPE_LABEL: Record<string, [string, string]> = {
  SUPERANNUATION: ["Superannuation pension", "अधिवर्षिता पेंशन"],
  VOLUNTARY: ["Voluntary retirement pension", "स्वैच्छिक सेवानिवृत्ति पेंशन"],
  INVALID: ["Invalid pension", "अशक्तता पेंशन"],
  COMPULSORY: ["Compulsory retirement pension", "अनिवार्य सेवानिवृत्ति पेंशन"],
  FAMILY: ["Family pension", "पारिवारिक पेंशन"],
};

/** Who a pension slip pays — kept on the slip so bills and slips read the same after the record changes. */
export interface PensionSlipDetail {
  ppoNumber: string;
  type: string;
  relation: string;
  payee: string;
  payeeHi: string | null;
}

export const pensionOfSlip = (detail: unknown): PensionSlipDetail | undefined => (detail as { pension?: PensionSlipDetail } | null)?.pension;

/** PN-03: the commuted part is restored on the day 15 years after commutation. */
export function restorationDate(commutationDate: ISODate): ISODate {
  const y = Number(commutationDate.slice(0, 4)) + 15;
  const md = commutationDate.slice(5);
  // 29 February commutation restores on 1 March of a non-leap year.
  const d = new Date(`${y}-${md}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(5, 10) !== md ? `${y}-03-01` : `${y}-${md}`;
}

/** Age in completed years on a date. */
export function ageOn(dob: ISODate, date: ISODate): number {
  const years = Number(date.slice(0, 4)) - Number(dob.slice(0, 4));
  return date.slice(5) >= dob.slice(5) ? years : years - 1;
}

export const ADDL_SLABS = [100, 95, 90, 85, 80] as const;

/**
 * PN-04: additional pension % for a month — from the 1st of the month in which the pensioner reaches 80, 85, 90, 95, 100.
 */
export function additionalPensionPct(dob: ISODate, month: string, rates: Record<string, number>): number {
  const age = ageOn(dob, endOfMonth(`${month}-01`));
  // Reaching the age on any day of the month counts from that month's 1st.
  for (const slab of ADDL_SLABS) if (age >= slab) return rates[`ADDL_PENSION_${slab}`] ?? 0;
  return 0;
}

/** Days of a month on which the pension runs, split by the rate in force (enhanced / normal family pension). */
export function pensionDays(f: PensionFacts, month: string): { days: number; enhancedDays: number; commutedDays: number; dim: number } {
  const dates = datesOfMonth(month);
  const restored = f.commutationDate ? restorationDate(f.commutationDate) : null;
  let days = 0;
  let enhancedDays = 0;
  let commutedDays = 0;
  for (const d of dates) {
    if (d < f.startDate || (f.endDate && d > f.endDate)) continue;
    days += 1;
    if (!f.reducedFrom || d < f.reducedFrom) enhancedDays += 1;
    if (f.commutedAmount > 0 && f.commutationDate && d >= f.commutationDate && (!restored || d < restored)) commutedDays += 1;
  }
  return { days, enhancedDays, commutedDays, dim: dates.length };
}

/** The pension for one month as pay lines (the same shape as a salary slip). `items` adds recoveries and TDS. */
export function computePension(input: { facts: PensionFacts; month: string; rates: Record<string, number>; heads: PensionHead[]; items?: Record<string, number> }): PayResult & { days: number } {
  const { facts: f, month, rates } = input;
  const heads = new Map(input.heads.map((h) => [h.code, h]));
  const lines: PayLine[] = [];
  let earnings = 0;
  let deductions = 0;
  const add = (code: string, paise: number) => {
    const h = heads.get(code);
    const rounded = roundPaiseToRupee(paise);
    if (!h || rounded <= 0) return 0;
    lines.push({ code, name: h.name, nameHi: h.nameHi, kind: h.kind, amount: fromPaise(rounded), accountHead: h.accountHead });
    if (h.kind === "EARNING") earnings += rounded;
    else if (h.kind === "DEDUCTION") deductions += rounded;
    return rounded;
  };
  const { days, enhancedDays, commutedDays, dim } = pensionDays(f, month);
  if (days === 0) return { lines, gross: 0, deductions: 0, net: 0, employer: 0, days };
  const normal = f.reducedPension ?? f.basicPension;
  const basicPaise = (toPaise(f.basicPension) * enhancedDays + toPaise(normal) * (days - enhancedDays)) / dim;
  const basic = add("BASIC_PENSION", basicPaise);
  const addl = add("ADDL_PENSION", percentOf(basic, additionalPensionPct(f.payeeDob, month, rates)));
  add("DR", percentOf(basic + addl, rates.DA_PERCENT ?? 0));
  if (f.fmaEligible) add("FMA", (toPaise(rates.FMA ?? 0) * days) / dim);
  if (commutedDays > 0) add("COMMUTATION", (toPaise(f.commutedAmount) * commutedDays) / dim);
  for (const [code, amount] of Object.entries(input.items ?? {})) if (amount > 0) add(code, toPaise(amount));
  const order = ["BASIC_PENSION", "ADDL_PENSION", "DR", "FMA", "COMMUTATION"];
  const rank = (l: PayLine) => (l.kind === "EARNING" ? 0 : 100) + (order.includes(l.code) ? order.indexOf(l.code) : 50);
  lines.sort((a, b) => rank(a) - rank(b));
  return { lines, gross: fromPaise(earnings), deductions: fromPaise(deductions), net: fromPaise(earnings - deductions), employer: 0, days };
}

/** Adds the lines of several months' pension into one set (a first pension slip paying earlier months too). */
export function sumLines(parts: PayLine[][]): PayLine[] {
  const by = new Map<string, PayLine>();
  for (const lines of parts) {
    for (const l of lines) {
      const t = by.get(l.code) ?? { ...l, amount: 0 };
      t.amount = fromPaise(toPaise(t.amount) + toPaise(l.amount));
      by.set(l.code, t);
    }
  }
  return [...by.values()];
}

// ─── Life certificates (PN-06) ────────────────────────────────────────────────

/**
 * Life certificates are given every November. A certificate given in October–December is good until 30 November of the
 * next year; one given earlier in the year (or the pension's start) only until 30 November of that year.
 */
export function lifeCertificateValidTill(certifiedOn: ISODate): ISODate {
  const y = Number(certifiedOn.slice(0, 4));
  const m = Number(certifiedOn.slice(5, 7));
  return m >= 10 ? `${y + 1}-11-30` : `${y}-11-30`;
}

/** PN-06: the pension is held once the certificate is more than a month overdue. */
export function lifeCertificateHoldFrom(validTill: ISODate): ISODate {
  return addDays(endOfMonth(addDays(validTill, 1)), 1);
}

export type LifeCertState = "VALID" | "DUE_SOON" | "OVERDUE" | "HELD";

export function lifeCertificateState(validTill: ISODate, today: ISODate): LifeCertState {
  if (today > validTill) return today >= lifeCertificateHoldFrom(validTill) ? "HELD" : "OVERDUE";
  return addDays(today, 30) >= validTill ? "DUE_SOON" : "VALID";
}
