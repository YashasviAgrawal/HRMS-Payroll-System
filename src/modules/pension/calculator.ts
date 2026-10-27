/**
 * PN-08: the new pension case calculator as pure rules — central rules (CCS (Pension) Rules 2021, CCS (Commutation of
 * Pension) Rules) as defaults, every figure from an editable dated table, to be confirmed against the Cantonment Board
 * Employees Service Rules 2021 (PRD §10).
 *
 * - Qualifying service: date of joining to the last day of service, less non-qualifying days (leave without pay,
 *   suspension not treated as duty, dies-non); counted in completed six-monthly periods, 3 months or more counting as a
 *   half-year, at most 66.
 * - Pension: 50% of emoluments (Basic + NPA, last drawn or the 10-month average, whichever is more) for 20 years or more,
 *   proportionately less down to 10 years; not below ₹9,000 nor above ₹1,25,000; rounded up to the rupee.
 * - Commutation: up to 40% of pension, in whole rupees; lump sum = commuted pension × 12 × the factor for the age next
 *   birthday on the day after retirement; absolute that day and restored after 15 years.
 * - Retirement gratuity: ¼ of emoluments (Basic + DA) for each six-monthly period, at most 16½ times, within the
 *   ceiling; service gratuity (½ month a period) instead of pension below 10 years. Death gratuity on a death in service
 *   by length of service.
 * - Leave encashment: earned leave up to 300 days × (Basic + DA) ÷ 30.
 * - Family pension: 30% of last pay (normal), 50% (enhanced, not more than the pension) for 7 years after retirement or
 *   until the pensioner would have reached 67, whichever is earlier; 10 years from death on a death in service.
 * - NPS staff (joined from 2004) get no pension from the Board — their pension comes from the NPS corpus — but the
 *   retirement or death gratuity (5 years' service for retirement gratuity) and leave encashment are paid the same way.
 */
import { addDays, type ISODate } from "@/lib/dates";
import { ageOn } from "./rules";

export type CaseType = "SUPERANNUATION" | "VOLUNTARY" | "INVALID" | "COMPULSORY" | "FAMILY";

/** Commutation factors by age next birthday (CCS (Commutation of Pension) Rules, table from 2 September 2008). */
export const COMMUTATION_FACTORS_2008: Record<string, number> = {
  "20": 9.188, "21": 9.187, "22": 9.186, "23": 9.185, "24": 9.184, "25": 9.183, "26": 9.182, "27": 9.18, "28": 9.178, "29": 9.176,
  "30": 9.173, "31": 9.169, "32": 9.164, "33": 9.159, "34": 9.152, "35": 9.145, "36": 9.136, "37": 9.126, "38": 9.116, "39": 9.103,
  "40": 9.09, "41": 9.075, "42": 9.059, "43": 9.04, "44": 9.019, "45": 8.996, "46": 8.971, "47": 8.943, "48": 8.913, "49": 8.881,
  "50": 8.846, "51": 8.808, "52": 8.768, "53": 8.724, "54": 8.678, "55": 8.627, "56": 8.572, "57": 8.512, "58": 8.446, "59": 8.371,
  "60": 8.287, "61": 8.194, "62": 8.093, "63": 7.982, "64": 7.862, "65": 7.731, "66": 7.591, "67": 7.431, "68": 7.262, "69": 7.083,
  "70": 6.897, "71": 6.703, "72": 6.502, "73": 6.296, "74": 6.085, "75": 5.872, "76": 5.657, "77": 5.443, "78": 5.229, "79": 5.018,
  "80": 4.812, "81": 4.611, "82": 4.415, "83": 4.225, "84": 4.042, "85": 3.866,
};

export interface CaseFacts {
  type: CaseType;
  /** Old pension scheme (GPF, pension from the Board) or NPS. */
  scheme: "OPS" | "NPS";
  dob: ISODate;
  doj: ISODate;
  /** Last day of service (or the date of death for a death in service). */
  retirementDate: ISODate;
  nonQualifyingDays: number;
  /** Basic + NPA on the last day. */
  lastPay: number;
  /** Average Basic + NPA of the last 10 months. */
  averagePay: number;
  /** DA % on the last day (gratuity and leave encashment are on Basic + DA). */
  daPercent: number;
  elDays: number;
  /** GPF balance with interest to date (OPS staff). */
  gpfBalance: number;
  commutationPct: number;
  rates: Record<string, number>;
  factors: Record<string, number>;
}

export interface QualifyingService {
  years: number;
  months: number;
  days: number;
  halfYears: number;
}

const r = Math.round;
const up = Math.ceil;

/** Years, months and days of service (both ends counted), less non-qualifying days; and six-monthly periods. */
export function qualifyingService(doj: ISODate, lastDay: ISODate, nonQualifyingDays: number): QualifyingService {
  const end = addDays(lastDay, 1);
  let years = Number(end.slice(0, 4)) - Number(doj.slice(0, 4));
  let months = Number(end.slice(5, 7)) - Number(doj.slice(5, 7));
  let days = Number(end.slice(8, 10)) - Number(doj.slice(8, 10));
  if (days < 0) {
    days += 30;
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }
  days -= Math.max(0, Math.round(nonQualifyingDays));
  while (days < 0) {
    days += 30;
    months -= 1;
    if (months < 0) {
      months += 12;
      years -= 1;
    }
  }
  if (years < 0) return { years: 0, months: 0, days: 0, halfYears: 0 };
  const totalMonths = years * 12 + months;
  const halfYears = Math.min(66, Math.floor(totalMonths / 6) + (totalMonths % 6 >= 3 ? 1 : 0));
  return { years, months, days, halfYears };
}

/** Age next birthday on a date. */
export const ageNextBirthday = (dob: ISODate, date: ISODate) => ageOn(dob, date) + 1;

export function factorFor(factors: Record<string, number>, age: number): number {
  if (factors[String(age)] !== undefined) return factors[String(age)];
  const ages = Object.keys(factors).map(Number).sort((a, b) => a - b);
  return factors[String(age < ages[0] ? ages[0] : ages[ages.length - 1])] ?? 0;
}

export function deathGratuity(emoluments: number, q: QualifyingService, ceiling: number): number {
  const years = q.halfYears / 2;
  const times = years < 1 ? 2 : years < 5 ? 6 : years < 11 ? 12 : years < 20 ? 20 : Math.min(33, q.halfYears / 2);
  return Math.min(r(emoluments * times), ceiling);
}

export interface CaseWorking {
  qs: QualifyingService;
  emoluments: { last: number; average: number; used: number; which: "LAST" | "AVERAGE"; withDa: number };
  pension: { eligible: boolean; amount: number; share: number };
  commutation: { pct: number; monthly: number; ageNextBirthday: number; factor: number; lumpSum: number; reducedPension: number; from: ISODate | null };
  gratuity: { kind: "RETIREMENT" | "DEATH" | "SERVICE" | "NONE"; amount: number };
  leaveEncashment: { days: number; amount: number };
  gpf: number;
  familyPension: { enhanced: number; normal: number; enhancedUntil: ISODate };
  /** Paid at once: gratuity + commuted value + leave encashment (GPF is paid from the fund). */
  lumpSum: number;
  pensionFrom: ISODate;
}

export function workOutCase(f: CaseFacts): CaseWorking {
  const rate = (k: string, d = 0) => f.rates[k] ?? d;
  const qs = qualifyingService(f.doj, f.retirementDate, f.nonQualifyingDays);
  const used = Math.max(f.lastPay, f.averagePay);
  const withDa = r(f.lastPay * (1 + f.daPercent / 100));
  const fullPeriods = rate("PENSION_FULL_YEARS", 20) * 2;
  const minPeriods = rate("PENSION_MIN_YEARS", 10) * 2;
  const death = f.type === "FAMILY";
  const nps = f.scheme === "NPS";
  const eligible = !nps && !death && qs.halfYears >= minPeriods && (f.type !== "VOLUNTARY" || qs.halfYears >= 40);
  const share = Math.min(1, qs.halfYears / fullPeriods);
  const raw = up((used * rate("PENSION_PERCENT", 50) * share) / 100);
  const amount = eligible ? Math.min(rate("PENSION_MAX", Infinity), Math.max(rate("PENSION_MIN", 0), raw)) : 0;
  const pensionFrom = addDays(f.retirementDate, 1);

  const pct = eligible ? Math.min(rate("COMMUTATION_MAX", 40), Math.max(0, f.commutationPct)) : 0;
  const monthly = Math.floor((amount * pct) / 100);
  const anb = ageNextBirthday(f.dob, pensionFrom);
  const factor = monthly ? factorFor(f.factors, anb) : 0;
  const lumpSum = r(monthly * 12 * factor);

  const ceiling = rate("GRATUITY_CEILING", Infinity);
  let gratuity: CaseWorking["gratuity"] = { kind: "NONE", amount: 0 };
  if (death) gratuity = { kind: "DEATH", amount: deathGratuity(withDa, qs, ceiling) };
  else if (!nps && !eligible && qs.halfYears > 0) gratuity = { kind: "SERVICE", amount: Math.min(r((withDa / 2) * qs.halfYears), ceiling) };
  else if (qs.halfYears >= 10) gratuity = { kind: "RETIREMENT", amount: Math.min(r((withDa * qs.halfYears) / 4), r(withDa * 16.5), ceiling) };

  const elDays = Math.min(Math.max(0, f.elDays), rate("LEAVE_ENCASH_MAX_DAYS", 300));
  const encashment = { days: elDays, amount: r((elDays * withDa) / 30) };

  const normal = nps ? 0 : Math.max(rate("PENSION_MIN", 0), up((f.lastPay * rate("FAMILY_PENSION_NORMAL", 30)) / 100));
  const enhancedRaw = up((f.lastPay * rate("FAMILY_PENSION_ENHANCED", 50)) / 100);
  const enhanced = nps ? 0 : Math.max(normal, death ? enhancedRaw : Math.min(enhancedRaw, amount || enhancedRaw));
  const sevenYears = `${Number(pensionFrom.slice(0, 4)) + (death ? 10 : 7)}${pensionFrom.slice(4)}`;
  const at67 = `${Number(f.dob.slice(0, 4)) + 67}${f.dob.slice(4)}`;
  const enhancedUntil = addDays(death || sevenYears < at67 ? sevenYears : at67, -1);

  return {
    qs,
    emoluments: { last: f.lastPay, average: f.averagePay, used, which: f.averagePay > f.lastPay ? "AVERAGE" : "LAST", withDa },
    pension: { eligible, amount, share },
    commutation: { pct, monthly, ageNextBirthday: anb, factor, lumpSum, reducedPension: amount - monthly, from: monthly ? pensionFrom : null },
    gratuity,
    leaveEncashment: encashment,
    gpf: nps ? 0 : Math.max(0, Math.round(f.gpfBalance)),
    familyPension: { enhanced, normal, enhancedUntil },
    lumpSum: gratuity.amount + lumpSum + encashment.amount,
    pensionFrom,
  };
}
