/**
 * The pay engine: one person's pay for one month, as pure arithmetic (PRD §8). No database, no dates of today —
 * everything it needs comes in, so the same function runs the payroll, the seed, the arrears (due vs drawn) and
 * the tests. Every head is worked out in paise and rounded to the rupee (50 paise and up goes up), as pay bills are.
 *
 * Worked example (PRD §8): Level 6, Cell 1, NPS, Delhi → Basic 35,400 + DA 21,240 + HRA 10,620 + TA 3,600 + DA on TA
 * 2,160 = gross 73,020; NPS 10% of Basic + DA = 5,664.
 *
 * Days (D-17): pay for the month is reduced for days not on the rolls this month (joining, leaving) and for last
 * month's locked dies-non and no-pay leave (loss days). Half-pay leave halves Basic and DA for those days; HRA and
 * TA continue during half-pay leave.
 */
import type { EmployeeType, PayHeadCalc, PayHeadKind } from "@/generated/prisma/enums";
import { fromPaise, percentOf, roundPaiseToRupee, toPaise } from "@/lib/money";

export interface HeadRule {
  code: string;
  name: string;
  nameHi: string;
  kind: PayHeadKind;
  calc: PayHeadCalc;
  value: number;
  postCodes: string[];
  prorate: boolean;
  countsForDa: boolean;
  accountHead: string;
}

export interface PayInput {
  type: EmployeeType;
  postCode: string;
  /** "A" | "B" | "C" — group insurance rate. */
  group: string;
  payLevel: string | null;
  /** Basic from the pay matrix for level + cell, in rupees (null for wage workers). */
  basic: number | null;
  wageRate: number | null;
  wageBasis: string | null;
  daysInMonth: number;
  /** Days on the rolls this month (joining / leaving). */
  daysOnRoll: number;
  /** Last month, from locked attendance: days in that month, dies-non + no-pay leave, half-pay leave, days worked. */
  last: { daysInMonth: number; lossDays: number; halfPayDays: number; workedDays: number } | null;
  /** Rates in force for the month (DA_PERCENT, HRA_PERCENT, …). */
  rates: Record<string, number>;
  heads: HeadRule[];
  /** Standing amounts for the month by head code (GPF subscription, licence fee, TDS…). */
  items: Record<string, number>;
}

export interface PayLine {
  code: string;
  name: string;
  nameHi: string;
  kind: PayHeadKind;
  /** Rupees. */
  amount: number;
  accountHead: string;
}

export interface PayResult {
  lines: PayLine[];
  gross: number;
  deductions: number;
  net: number;
  employer: number;
}

const MATRIX_TYPES: EmployeeType[] = ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION"];
const WAGE_TYPES: EmployeeType[] = ["CONTRACT", "DAILY_WAGE", "REEMPLOYED"];

/** Transport allowance tier by level (Delhi is a higher-TPTA city). */
export function transportAllowance(level: string | null, basic: number, rates: Record<string, number>): number {
  if (!level) return 0;
  const n = Number(level.replace(/[^0-9]/g, ""));
  if (n >= 9) return rates.TA_HIGH ?? 0;
  if (n >= 3) return rates.TA_MID ?? 0;
  return basic >= (rates.TA_LOW_PAY_LIMIT ?? Infinity) ? (rates.TA_MID ?? 0) : (rates.TA_LOW ?? 0);
}

export function computePay(input: PayInput): PayResult {
  const r = input.rates;
  const heads = new Map(input.heads.map((h) => [h.code, h]));
  const lines: PayLine[] = [];
  const add = (code: string, paise: number) => {
    const h = heads.get(code);
    if (!h || paise === 0) return;
    lines.push({ code, name: h.name, nameHi: h.nameHi, kind: h.kind, amount: fromPaise(roundPaiseToRupee(paise)), accountHead: h.accountHead });
  };
  // Share of the month paid: on the rolls this month, less last month's loss days (counted in that month's length).
  const onRoll = input.daysOnRoll / input.daysInMonth;
  const loss = input.last ? input.last.lossDays / input.last.daysInMonth : 0;
  const halfPay = input.last ? (0.5 * input.last.halfPayDays) / input.last.daysInMonth : 0;
  const share = Math.max(0, onRoll - loss);
  const payShare = Math.max(0, onRoll - loss - halfPay);
  const isMatrix = MATRIX_TYPES.includes(input.type);
  const appliesToPost = (h: HeadRule) => h.postCodes.length === 0 || h.postCodes.includes(input.postCode);

  let pay = 0; // paise that count for DA and NPS (Basic + NPA)
  let earnings = 0;

  if (isMatrix && input.basic !== null) {
    const basic = roundPaiseToRupee(toPaise(input.basic) * payShare);
    add("BASIC", basic);
    pay += basic;
    // Percentage-of-Basic allowances for listed posts (NPA counts for DA).
    for (const h of input.heads) {
      if (h.kind !== "EARNING" || h.calc !== "PERCENT_BASIC" || !h.postCodes.includes(input.postCode)) continue;
      const amt = percentOf(basic, h.value);
      add(h.code, amt);
      if (h.countsForDa) pay += amt;
      else earnings += amt;
    }
    const da = percentOf(pay, r.DA_PERCENT ?? 0);
    add("DA", da);
    const fullBasic = toPaise(input.basic);
    const hra = roundPaiseToRupee(Math.max(percentOf(fullBasic, r.HRA_PERCENT ?? 0), toPaise(r.HRA_MIN ?? 0)) * share);
    add("HRA", hra);
    const ta = roundPaiseToRupee(toPaise(transportAllowance(input.payLevel, input.basic, r)) * share);
    add("TA", ta);
    const daTa = percentOf(ta, r.DA_PERCENT ?? 0);
    add("DA_TA", daTa);
    earnings += pay + da + hra + ta + daTa;
  } else if (WAGE_TYPES.includes(input.type) && input.wageRate !== null) {
    const rate = toPaise(input.wageRate);
    const wages = input.wageBasis === "DAILY" ? roundPaiseToRupee(rate * (input.last?.workedDays ?? 0)) : roundPaiseToRupee(rate * share);
    add("WAGES", wages);
    earnings += wages;
  }

  // Fixed allowances for listed posts, and standing earnings.
  for (const h of input.heads) {
    if (h.kind !== "EARNING") continue;
    if (h.calc === "FIXED" && h.postCodes.includes(input.postCode)) {
      const amt = roundPaiseToRupee(toPaise(h.value) * (h.prorate ? share : 1));
      add(h.code, amt);
      earnings += amt;
    } else if (h.calc === "ITEM" && input.items[h.code] && appliesToPost(h)) {
      const amt = roundPaiseToRupee(toPaise(input.items[h.code]) * (h.prorate ? share : 1));
      add(h.code, amt);
      earnings += amt;
    }
  }

  // Deductions.
  let deductions = 0;
  const deduct = (code: string, paise: number) => {
    if (paise <= 0 || !heads.has(code)) return;
    add(code, paise);
    deductions += roundPaiseToRupee(paise);
  };
  let employer = 0;
  const employerShare = (code: string, paise: number) => {
    if (paise <= 0 || !heads.has(code)) return;
    add(code, paise);
    employer += roundPaiseToRupee(paise);
  };
  const daPaid = lines.find((l) => l.code === "DA")?.amount ?? 0;
  const payDa = pay + toPaise(daPaid);
  if (input.type === "PERMANENT_NPS") {
    deduct("NPS", percentOf(payDa, r.NPS_EMPLOYEE ?? 0));
    employerShare("NPS_ER", percentOf(payDa, r.NPS_EMPLOYER ?? 0));
  }
  if (input.type === "PERMANENT_OPS") {
    const minimum = percentOf(toPaise(input.basic ?? 0), r.GPF_MIN ?? 0);
    deduct("GPF", input.items.GPF !== undefined ? toPaise(input.items.GPF) : minimum);
    employerShare("PENSION_ER", percentOf(payDa, r.PENSION_EMPLOYER ?? 0));
  }
  if (isMatrix) deduct("GIS", toPaise(r[`GIS_${input.group}`] ?? 0));
  if (input.type === "CONTRACT" || input.type === "DAILY_WAGE") {
    const wages = toPaise(lines.find((l) => l.code === "WAGES")?.amount ?? 0);
    const pfWages = Math.min(wages, toPaise(r.EPF_CEILING ?? Infinity));
    deduct("EPF", percentOf(pfWages, r.EPF_EMPLOYEE ?? 0));
    employerShare("EPF_ER", percentOf(pfWages, r.EPF_EMPLOYER ?? 0));
    if (earnings > 0 && earnings <= toPaise(r.ESIC_CEILING ?? 0)) {
      // ESIC shares are rounded up to the next rupee.
      deduct("ESIC", percentOf(earnings, r.ESIC_EMPLOYEE ?? 0, "UP"));
      employerShare("ESIC_ER", percentOf(earnings, r.ESIC_EMPLOYER ?? 0, "UP"));
    }
  }
  for (const h of input.heads) {
    if (h.kind === "DEDUCTION" && h.calc === "ITEM" && input.items[h.code]) deduct(h.code, toPaise(input.items[h.code]));
  }

  const order = new Map(input.heads.map((h, i) => [h.code, i]));
  lines.sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0));
  const gross = fromPaise(earnings);
  const ded = fromPaise(deductions);
  return { lines, gross, deductions: ded, net: fromPaise(earnings - deductions), employer: fromPaise(employer) };
}

/** PR-05: which pay group a person's bill belongs to. */
export function payGroupOf(type: EmployeeType): "OPS" | "NPS" | "CONTRACT" {
  if (type === "PERMANENT_NPS") return "NPS";
  if (type === "PERMANENT_OPS" || type === "DEPUTATION") return "OPS";
  return "CONTRACT";
}

export const TYPES_IN_GROUP: Record<"OPS" | "NPS" | "CONTRACT", EmployeeType[]> = {
  OPS: ["PERMANENT_OPS", "DEPUTATION"],
  NPS: ["PERMANENT_NPS"],
  CONTRACT: ["CONTRACT", "DAILY_WAGE", "REEMPLOYED"],
};
