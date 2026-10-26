/**
 * Income tax on salary as pure rules (ST-02, ST-04) — shared by the payroll, the employee's tax page, Form 16 and the tests.
 *
 * Defaults follow the Finance Act 2025 for FY 2025-26 onwards (new regime: ₹75,000 standard deduction, rebate u/s 87A
 * up to ₹12 lakh with marginal relief; old regime: ₹50,000 standard deduction, rebate up to ₹5 lakh) and 4% cess.
 * Every figure is an editable dated table (ST-01); surcharge above ₹50 lakh is not applied — no Board salary reaches it.
 */
export type Regime = "NEW" | "OLD";

export interface TaxSlab {
  /** Upper end of the slab in rupees; null for "above". */
  upTo: number | null;
  /** % */
  rate: number;
}

export interface TaxRuleSet {
  slabs: TaxSlab[];
  standardDeduction: number;
  rebateIncomeLimit: number;
  rebateMax: number;
  cessPercent: number;
}

export const TAX_DEFAULTS: Record<Regime, TaxRuleSet> = {
  NEW: {
    slabs: [
      { upTo: 400000, rate: 0 },
      { upTo: 800000, rate: 5 },
      { upTo: 1200000, rate: 10 },
      { upTo: 1600000, rate: 15 },
      { upTo: 2000000, rate: 20 },
      { upTo: 2400000, rate: 25 },
      { upTo: null, rate: 30 },
    ],
    standardDeduction: 75000,
    rebateIncomeLimit: 1200000,
    rebateMax: 60000,
    cessPercent: 4,
  },
  OLD: {
    slabs: [
      { upTo: 250000, rate: 0 },
      { upTo: 500000, rate: 5 },
      { upTo: 1000000, rate: 20 },
      { upTo: null, rate: 30 },
    ],
    standardDeduction: 50000,
    rebateIncomeLimit: 500000,
    rebateMax: 12500,
    cessPercent: 4,
  },
};

/** Limits on old-regime deductions (Chapter VI-A), rupees a year. */
export const DEDUCTION_CAPS = { sec80C: 150000, sec80D: 75000, sec80CCD1B: 50000, homeLoanInterest: 200000 };

export interface DeclaredItems {
  sec80C: number;
  sec80D: number;
  sec80CCD1B: number;
  homeLoanInterest: number;
  /** Rent paid in the year — for the HRA exemption (old regime). */
  rentPaid: number;
  /** Income from other sources the employee wants taxed through salary. */
  otherIncome: number;
}

export const EMPTY_ITEMS: DeclaredItems = { sec80C: 0, sec80D: 0, sec80CCD1B: 0, homeLoanInterest: 0, rentPaid: 0, otherIncome: 0 };

const r = (n: number) => Math.round(n);

/** Tax on the slabs, then the 87A rebate (with marginal relief in the new regime), then cess. */
export function taxOnIncome(taxable: number, rules: TaxRuleSet, regime: Regime) {
  const income = Math.max(0, Math.floor(taxable / 10) * 10); // income is rounded to the nearest ₹10 below (s. 288A)
  let tax = 0;
  let from = 0;
  for (const s of rules.slabs) {
    const top = s.upTo ?? Infinity;
    if (income > from) tax += ((Math.min(income, top) - from) * s.rate) / 100;
    from = top;
    if (income <= top) break;
  }
  let rebate = 0;
  if (income <= rules.rebateIncomeLimit) rebate = Math.min(tax, rules.rebateMax);
  else if (regime === "NEW" && tax > income - rules.rebateIncomeLimit) rebate = tax - (income - rules.rebateIncomeLimit); // marginal relief
  const afterRebate = Math.max(0, tax - rebate);
  const cess = (afterRebate * rules.cessPercent) / 100;
  return { income, tax: r(tax), rebate: r(rebate), cess: r(cess), total: r(afterRebate + cess) };
}

export interface AnnualSalary {
  /** Taxable earnings for the year (paid so far + projected). */
  gross: number;
  /** Basic + DA for the year — for the HRA exemption. */
  basicDa: number;
  hra: number;
  /** Board's NPS contribution — deductible u/s 80CCD(2) in both regimes. */
  employerNps: number;
  /** Employee's own NPS — part of 80C / 80CCD(1) in the old regime. */
  employeeNps: number;
  /** GPF subscription — part of 80C in the old regime. */
  gpf: number;
  professionalTax: number;
}

export interface TaxWorking {
  regime: Regime;
  gross: number;
  standardDeduction: number;
  hraExempt: number;
  professionalTax: number;
  employerNps: number;
  chapterVIA: { sec80C: number; sec80D: number; sec80CCD1B: number; homeLoanInterest: number };
  otherIncome: number;
  taxable: number;
  tax: number;
  rebate: number;
  cess: number;
  total: number;
}

/** The year's tax working for one person — what Form 16 Part B prints and what the monthly TDS spreads. */
export function taxWorking(sal: AnnualSalary, regime: Regime, items: DeclaredItems, rules: TaxRuleSet, metro = true): TaxWorking {
  const old = regime === "OLD";
  const hraExempt = old && items.rentPaid > 0 ? Math.max(0, Math.min(sal.hra, items.rentPaid - 0.1 * sal.basicDa, (metro ? 0.5 : 0.4) * sal.basicDa)) : 0;
  const chapterVIA = old
    ? {
        sec80C: Math.min(DEDUCTION_CAPS.sec80C, items.sec80C + sal.employeeNps + sal.gpf),
        sec80D: Math.min(DEDUCTION_CAPS.sec80D, items.sec80D),
        sec80CCD1B: Math.min(DEDUCTION_CAPS.sec80CCD1B, items.sec80CCD1B),
        homeLoanInterest: Math.min(DEDUCTION_CAPS.homeLoanInterest, items.homeLoanInterest),
      }
    : { sec80C: 0, sec80D: 0, sec80CCD1B: 0, homeLoanInterest: 0 };
  const professionalTax = old ? sal.professionalTax : 0;
  const deductions = rules.standardDeduction + hraExempt + professionalTax + sal.employerNps + chapterVIA.sec80C + chapterVIA.sec80D + chapterVIA.sec80CCD1B + chapterVIA.homeLoanInterest;
  const taxable = Math.max(0, sal.gross + items.otherIncome - deductions);
  const t = taxOnIncome(taxable, rules, regime);
  return { regime, gross: r(sal.gross), standardDeduction: rules.standardDeduction, hraExempt: r(hraExempt), professionalTax: r(professionalTax), employerNps: r(sal.employerNps), chapterVIA, otherIncome: items.otherIncome, taxable: t.income, tax: t.tax, rebate: t.rebate, cess: t.cess, total: t.total };
}

/** ST-04: the year's tax less what is already deducted, spread over the months left (this one included). */
export function monthlyTds(annualTax: number, deductedSoFar: number, monthsLeft: number): number {
  if (monthsLeft <= 0) return 0;
  return Math.max(0, Math.round((annualTax - deductedSoFar) / monthsLeft));
}

/** Financial year of a month: "2026-10" → "2026-27". */
export function fyOfMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const start = Number(month.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** First and last month of a financial year: "2026-27" → ["2026-04", "2027-03"]. */
export function fyMonths(fy: string): [string, string] {
  const start = Number(fy.slice(0, 4));
  return [`${start}-04`, `${start + 1}-03`];
}

/** Months from this one to March, this one included. */
export function monthsLeftInFy(month: string): number {
  const m = Number(month.slice(5, 7));
  return m >= 4 ? 16 - m : 4 - m;
}

/** Quarter of a financial year for a month: Apr–Jun = 1 … Jan–Mar = 4. */
export function quarterOf(month: string): 1 | 2 | 3 | 4 {
  const m = Number(month.slice(5, 7));
  return (m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4) as 1 | 2 | 3 | 4;
}

export interface PtSlab {
  upTo: number | null;
  amount: number;
}

/** Professional tax for a month's gross from the Board's slabs (switched off in Delhi). */
export function professionalTaxFor(monthlyGross: number, slabs: PtSlab[]): number {
  if (monthlyGross <= 0) return 0;
  const sorted = [...slabs].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  return sorted.find((s) => monthlyGross <= (s.upTo ?? Infinity))?.amount ?? 0;
}
