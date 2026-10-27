import { describe, expect, it } from "vitest";
import { COMMUTATION_FACTORS_2008, deathGratuity, qualifyingService, workOutCase, type CaseFacts } from "@/modules/pension/calculator";
import { additionalPensionPct, computePension, lifeCertificateHoldFrom, lifeCertificateState, lifeCertificateValidTill, restorationDate, type PensionFacts, type PensionHead } from "@/modules/pension/rules";

const RATES: Record<string, number> = {
  DA_PERCENT: 60,
  FMA: 1000,
  PENSION_PERCENT: 50,
  PENSION_FULL_YEARS: 20,
  PENSION_MIN_YEARS: 10,
  PENSION_MIN: 9000,
  PENSION_MAX: 125000,
  FAMILY_PENSION_ENHANCED: 50,
  FAMILY_PENSION_NORMAL: 30,
  COMMUTATION_MAX: 40,
  GRATUITY_CEILING: 2500000,
  LEAVE_ENCASH_MAX_DAYS: 300,
  ADDL_PENSION_80: 20,
  ADDL_PENSION_85: 30,
  ADDL_PENSION_90: 40,
  ADDL_PENSION_95: 50,
  ADDL_PENSION_100: 100,
};

const HEADS: PensionHead[] = [
  { code: "BASIC_PENSION", name: "Basic pension", nameHi: "मूल पेंशन", kind: "EARNING", accountHead: "E-2.01" },
  { code: "ADDL_PENSION", name: "Additional pension", nameHi: "अतिरिक्त पेंशन", kind: "EARNING", accountHead: "E-2.01" },
  { code: "DR", name: "Dearness relief", nameHi: "महँगाई राहत", kind: "EARNING", accountHead: "E-2.02" },
  { code: "FMA", name: "Fixed medical allowance", nameHi: "नियत चिकित्सा भत्ता", kind: "EARNING", accountHead: "E-2.03" },
  { code: "COMMUTATION", name: "Commuted part", nameHi: "रूपांतरित भाग", kind: "DEDUCTION", accountHead: "E-2.01" },
  { code: "RECOVERY", name: "Overpayment recovery", nameHi: "वसूली", kind: "DEDUCTION", accountHead: "D-2.10" },
];

const facts = (over: Partial<PensionFacts> = {}): PensionFacts => ({
  type: "SUPERANNUATION",
  basicPension: 30000,
  reducedPension: null,
  reducedFrom: null,
  commutedAmount: 12000,
  commutationDate: "2020-02-01",
  payeeDob: "1945-03-10",
  fmaEligible: true,
  startDate: "2005-03-01",
  endDate: null,
  ...over,
});
const amount = (r: { lines: { code: string; amount: number }[] }, code: string) => r.lines.find((l) => l.code === code)?.amount ?? 0;

describe("PN-02 to PN-04: a month's pension", () => {
  it("basic + additional pension at 80 + DR on both + medical allowance, less the commuted part", () => {
    const p = computePension({ facts: facts(), month: "2026-10", rates: RATES, heads: HEADS });
    expect([amount(p, "BASIC_PENSION"), amount(p, "ADDL_PENSION"), amount(p, "DR"), amount(p, "FMA"), amount(p, "COMMUTATION")]).toEqual([30000, 6000, 21600, 1000, 12000]);
    expect(p).toMatchObject({ gross: 58600, deductions: 12000, net: 46600, days: 31 });
  });

  it("additional pension starts from the 1st of the month of the 80th birthday, and steps up at 85", () => {
    expect(additionalPensionPct("1946-10-25", "2026-09", RATES)).toBe(0);
    expect(additionalPensionPct("1946-10-25", "2026-10", RATES)).toBe(20);
    expect(additionalPensionPct("1941-10-25", "2026-10", RATES)).toBe(30);
    expect(additionalPensionPct("1926-01-01", "2026-01", RATES)).toBe(100);
  });

  it("restores the commuted part 15 years after commutation, by days in that month", () => {
    expect(restorationDate("2011-10-16")).toBe("2026-10-16");
    expect(restorationDate("2012-02-29")).toBe("2027-03-01");
    const p = computePension({ facts: facts({ commutationDate: "2011-10-16" }), month: "2026-10", rates: RATES, heads: HEADS });
    expect(amount(p, "COMMUTATION")).toBe(5806);
    const after = computePension({ facts: facts({ commutationDate: "2011-10-16" }), month: "2026-11", rates: RATES, heads: HEADS });
    expect(amount(after, "COMMUTATION")).toBe(0);
  });

  it("pays a part month by days: a start mid-month, and family pension moving from the enhanced to the normal rate", () => {
    const start = computePension({ facts: facts({ startDate: "2026-10-21", commutedAmount: 0, payeeDob: "1966-10-01" }), month: "2026-10", rates: RATES, heads: HEADS });
    expect(amount(start, "BASIC_PENSION")).toBe(10645);
    expect(amount(start, "FMA")).toBe(355);
    const fp = computePension({ facts: facts({ type: "FAMILY", basicPension: 20000, reducedPension: 12000, reducedFrom: "2026-10-11", commutedAmount: 0, payeeDob: "1970-01-01" }), month: "2026-10", rates: RATES, heads: HEADS });
    expect(amount(fp, "BASIC_PENSION")).toBe(14581);
    const ended = computePension({ facts: facts({ endDate: "2026-09-30" }), month: "2026-10", rates: RATES, heads: HEADS });
    expect(ended.lines).toHaveLength(0);
  });

  it("takes recoveries as further deductions", () => {
    const p = computePension({ facts: facts(), month: "2026-10", rates: RATES, heads: HEADS, items: { RECOVERY: 5000 } });
    expect(p.deductions).toBe(17000);
    expect(p.net).toBe(41600);
  });
});

describe("PN-06: life certificates", () => {
  it("are given in November and held a month after they run out", () => {
    expect(lifeCertificateValidTill("2025-11-12")).toBe("2026-11-30");
    expect(lifeCertificateValidTill("2026-03-01")).toBe("2026-11-30");
    expect(lifeCertificateHoldFrom("2026-11-30")).toBe("2027-01-01");
    expect(lifeCertificateState("2026-11-30", "2026-06-01")).toBe("VALID");
    expect(lifeCertificateState("2026-11-30", "2026-11-10")).toBe("DUE_SOON");
    expect(lifeCertificateState("2026-11-30", "2026-12-15")).toBe("OVERDUE");
    expect(lifeCertificateState("2026-11-30", "2027-01-02")).toBe("HELD");
  });
});

describe("PN-08: the pension case calculator", () => {
  const base: CaseFacts = {
    type: "SUPERANNUATION",
    scheme: "OPS",
    dob: "1968-01-01",
    doj: "1991-08-01",
    retirementDate: "2028-01-31",
    nonQualifyingDays: 0,
    lastPay: 151100,
    averagePay: 149000,
    daPercent: 60,
    elDays: 300,
    gpfBalance: 4200000,
    commutationPct: 40,
    rates: RATES,
    factors: COMMUTATION_FACTORS_2008,
  };

  it("counts qualifying service in six-monthly periods (3 months or more is a half-year), at most 66", () => {
    expect(qualifyingService("1991-08-01", "2028-01-31", 0)).toEqual({ years: 36, months: 6, days: 0, halfYears: 66 });
    expect(qualifyingService("2012-03-01", "2026-11-30", 45)).toEqual({ years: 14, months: 7, days: 15, halfYears: 29 });
    expect(qualifyingService("2012-03-01", "2026-11-30", 0).halfYears).toBe(30);
  });

  it("works out full pension, commutation, gratuity (within the ceiling), leave encashment and family pension", () => {
    const w = workOutCase(base);
    expect(w.pension).toMatchObject({ eligible: true, amount: 75550, share: 1 });
    expect(w.commutation).toMatchObject({ pct: 40, monthly: 30220, ageNextBirthday: 61, factor: 8.194, lumpSum: 2971472, reducedPension: 45330, from: "2028-02-01" });
    expect(w.emoluments.withDa).toBe(241760);
    expect(w.gratuity).toEqual({ kind: "RETIREMENT", amount: 2500000 });
    expect(w.leaveEncashment).toEqual({ days: 300, amount: 2417600 });
    expect(w.familyPension).toEqual({ enhanced: 75550, normal: 45330, enhancedUntil: "2034-12-31" });
    expect(w.lumpSum).toBe(2500000 + 2971472 + 2417600);
    expect(w.pensionFrom).toBe("2028-02-01");
  });

  it("gives proportionate pension below 20 years, and service gratuity instead of pension below 10", () => {
    const w = workOutCase({ ...base, doj: "2013-02-01", lastPay: 40000, averagePay: 39000, commutationPct: 0 });
    expect(w.qs.halfYears).toBe(30);
    expect(w.pension.amount).toBe(15000);
    const short = workOutCase({ ...base, doj: "2020-02-01", lastPay: 40000, averagePay: 39000 });
    expect(short.pension).toMatchObject({ eligible: false, amount: 0 });
    expect(short.gratuity).toEqual({ kind: "SERVICE", amount: Math.round((64000 / 2) * 16) });
    expect(short.commutation.lumpSum).toBe(0);
  });

  it("never pays less than the lowest pension", () => {
    expect(workOutCase({ ...base, doj: "2013-02-01", lastPay: 18000, averagePay: 18000 }).pension.amount).toBe(9000);
  });

  it("for NPS staff: no Board pension or GPF, but retirement gratuity (5 years or more) and leave encashment", () => {
    // 3 Apr 2006 – 31 Jan 2028: 21 years 9 months 28 days = 44 half-years; Basic + DA = 60,000 × 1.6 = 96,000.
    const w = workOutCase({ ...base, scheme: "NPS", doj: "2006-04-03", lastPay: 60000, averagePay: 59000 });
    expect(w.qs.halfYears).toBe(44);
    expect(w.pension).toMatchObject({ eligible: false, amount: 0 });
    expect(w.commutation.lumpSum).toBe(0);
    expect(w.gratuity).toEqual({ kind: "RETIREMENT", amount: 1056000 });
    expect(w.familyPension).toMatchObject({ enhanced: 0, normal: 0 });
    expect(w.gpf).toBe(0);
    expect(w.leaveEncashment.amount).toBe(960000);
    expect(workOutCase({ ...base, scheme: "NPS", doj: "2024-02-01" }).gratuity.kind).toBe("NONE");
  });

  it("on a death in service: death gratuity by length of service and enhanced family pension for 10 years", () => {
    const w = workOutCase({ ...base, type: "FAMILY", doj: "2023-06-01", retirementDate: "2026-09-14", lastPay: 50000, averagePay: 50000 });
    expect(w.pension.eligible).toBe(false);
    expect(w.gratuity).toEqual({ kind: "DEATH", amount: 6 * 80000 });
    expect(w.familyPension).toEqual({ enhanced: 25000, normal: 15000, enhancedUntil: "2036-09-14" });
    expect(deathGratuity(80000, { years: 25, months: 0, days: 0, halfYears: 50 }, 2500000)).toBe(2000000);
  });
});
