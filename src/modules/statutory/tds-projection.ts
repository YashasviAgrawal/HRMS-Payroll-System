/**
 * ST-04: monthly TDS projected on the full year's salary. For each person: what the year's approved pay bills have paid
 * so far (and any salary of the year paid outside it — old system, previous employer) + this month + this month's full pay for each month still to come (to March, or to the month the person leaves)
 * → the year's tax under the chosen regime (ST-02) with the declared deductions (ST-03) → less the tax already deducted,
 * spread over the months left. Re-worked every month, so it adjusts itself; from January only deductions whose proofs
 * HR & Accounts have verified count, which is the final-quarter adjustment.
 *
 * No "server-only": the payroll working (and so the demo seed) uses it.
 */
import type { PayHead } from "@/generated/prisma/client";
import type { DbLike } from "@/lib/db";
import type { PayLine } from "@/modules/payroll/engine";
import { statutorySettings } from "./settings";
import { EMPTY_ITEMS, fyMonths, fyOfMonth, monthlyTds, TAX_DEFAULTS, taxWorking, type DeclaredItems, type Regime, type TaxRuleSet, type TaxSlab } from "./tax-rules";

const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;

/** The parts of pay the tax working needs, in rupees. */
export interface SalaryParts {
  gross: number;
  basicDa: number;
  hra: number;
  employerNps: number;
  employeeNps: number;
  gpf: number;
  professionalTax: number;
  tds: number;
}

export const ZERO_PARTS: SalaryParts = { gross: 0, basicDa: 0, hra: 0, employerNps: 0, employeeNps: 0, gpf: 0, professionalTax: 0, tds: 0 };

/** Which heads are taxable earnings and which count as pay (Basic + DA) for the HRA exemption. */
export interface HeadFlags {
  taxable: Set<string>;
  pay: Set<string>;
}

export function headFlags(heads: Pick<PayHead, "code" | "kind" | "taxable" | "countsForDa">[]): HeadFlags {
  return {
    taxable: new Set(heads.filter((h) => h.kind === "EARNING" && h.taxable).map((h) => h.code)),
    pay: new Set(["BASIC", "DA", ...heads.filter((h) => h.countsForDa).map((h) => h.code)]),
  };
}

export function partsOf(lines: PayLine[], flags: HeadFlags): SalaryParts {
  const p = { ...ZERO_PARTS };
  for (const l of lines) {
    if (l.kind === "EARNING" && flags.taxable.has(l.code)) p.gross += l.amount;
    if (l.kind === "EARNING" && flags.pay.has(l.code)) p.basicDa += l.amount;
    if (l.code === "HRA") p.hra += l.amount;
    if (l.code === "NPS_ER") p.employerNps += l.amount;
    if (l.code === "NPS") p.employeeNps += l.amount;
    if (l.code === "GPF") p.gpf += l.amount;
    if (l.code === "PT") p.professionalTax += l.amount;
    if (l.code === "IT") p.tds += l.amount;
  }
  return p;
}

export function addParts(a: SalaryParts, b: SalaryParts, times = 1): SalaryParts {
  const out = { ...a };
  for (const k of Object.keys(out) as (keyof SalaryParts)[]) out[k] = Math.round((a[k] + b[k] * times) * 100) / 100;
  return out;
}

export interface Declared {
  regime: Regime;
  items: DeclaredItems;
  /** Which figures were used: declared (April–December), proof-verified, or none. */
  basis: "DECLARED" | "VERIFIED" | "NONE";
}

/**
 * The regime and deductions that count for a month. The regime is the person's choice once sent (new regime by default);
 * deductions count as declared until December and only once verified from January (proofs are due before January).
 */
export function declaredFor(d: { regime: string; status: string; items: unknown } | undefined, month: string): Declared {
  if (!d || d.status === "DRAFT") return { regime: "NEW", items: EMPTY_ITEMS, basis: "NONE" };
  const regime = (d.regime === "OLD" ? "OLD" : "NEW") as Regime;
  const items = { ...EMPTY_ITEMS, ...((d.items ?? {}) as Partial<DeclaredItems>) };
  const finalQuarter = Number(month.slice(5, 7)) <= 3;
  if (d.status === "VERIFIED") return { regime, items, basis: "VERIFIED" };
  if (d.status === "SUBMITTED" && !finalQuarter) return { regime, items, basis: "DECLARED" };
  return { regime, items: EMPTY_ITEMS, basis: "NONE" };
}

/** Tax rules for a year from the editable table; the built-in defaults where a year has not been set up. */
export async function taxRulesFor(tx: DbLike, boardId: string, fy: string): Promise<Record<Regime, TaxRuleSet>> {
  const rows = await tx.taxRule.findMany({ where: { boardId, fy } });
  const out: Record<Regime, TaxRuleSet> = { NEW: TAX_DEFAULTS.NEW, OLD: TAX_DEFAULTS.OLD };
  for (const r of rows) {
    if (r.regime !== "NEW" && r.regime !== "OLD") continue;
    out[r.regime] = { slabs: r.slabs as unknown as TaxSlab[], standardDeduction: num(r.standardDeduction), rebateIncomeLimit: num(r.rebateIncomeLimit), rebateMax: num(r.rebateMax), cessPercent: num(r.cessPercent) };
  }
  return out;
}

export interface TaxDetail {
  fy: string;
  regime: Regime;
  basis: Declared["basis"];
  /** The year's taxable salary as projected this month. */
  projectedGross: number;
  taxable: number;
  annualTax: number;
  deductedSoFar: number;
  monthsLeft: number;
  monthly: number;
}

export interface TaxContext {
  fy: string;
  month: string;
  rules: Record<Regime, TaxRuleSet>;
  metro: boolean;
  declarations: Map<string, { regime: string; status: string; items: unknown }>;
  paid: Map<string, SalaryParts>;
}

/** Everything the projection reads for a group of people in one go: rules, declarations, the year's approved pay. */
export async function taxContext(tx: DbLike, boardId: string, employeeIds: string[], month: string, flags: HeadFlags): Promise<TaxContext> {
  const fy = fyOfMonth(month);
  const [from, to] = fyMonths(fy);
  const [rules, settings, declarations, carried, slips] = await Promise.all([
    taxRulesFor(tx, boardId, fy),
    statutorySettings(tx, boardId),
    tx.taxDeclaration.findMany({ where: { employeeId: { in: employeeIds }, fy }, select: { employeeId: true, regime: true, status: true, items: true } }),
    tx.taxCarryIn.findMany({ where: { employeeId: { in: employeeIds }, fy } }),
    // Every approved bill of the year except this month's regular bill, which is the one being worked out.
    tx.payslip.findMany({
      where: { employeeId: { in: employeeIds }, month: { gte: from, lte: to }, status: "INCLUDED", run: { status: { in: [...PAID] }, NOT: { kind: "REGULAR", month } } },
      select: { employeeId: true, lines: true },
    }),
  ]);
  const paid = new Map<string, SalaryParts>();
  // Salary and TDS of the year paid outside this system (old system before cut-over, previous employer).
  for (const c of carried) paid.set(c.employeeId, { ...ZERO_PARTS, gross: num(c.salary), tds: num(c.tds) });
  for (const s of slips) paid.set(s.employeeId, addParts(paid.get(s.employeeId) ?? ZERO_PARTS, partsOf(s.lines as unknown as PayLine[], flags)));
  return { fy, month, rules, metro: settings.metroHra, declarations: new Map(declarations.map((d) => [d.employeeId, d])), paid };
}

/** Months after this one that the person will still be paid in this year (to March, or to the month of leaving). */
export function monthsStillToCome(month: string, fy: string, lastDay: string | null): number {
  const [, fyEnd] = fyMonths(fy);
  const end = lastDay && lastDay.slice(0, 7) < fyEnd ? lastDay.slice(0, 7) : fyEnd;
  const [y1, m1] = month.split("-").map(Number);
  const [y2, m2] = end.split("-").map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1));
}

/**
 * One person's TDS for the month. `current` is this month's pay (before tax); `monthly` the full month's pay used for
 * the months to come; `toCome` how many of those there are.
 */
export function projectTds(ctx: TaxContext, employeeId: string, current: SalaryParts, monthly: SalaryParts, toCome: number): TaxDetail {
  const paid = ctx.paid.get(employeeId) ?? ZERO_PARTS;
  const year = addParts(addParts(paid, current), monthly, toCome);
  const declared = declaredFor(ctx.declarations.get(employeeId), ctx.month);
  const w = taxWorking(year, declared.regime, declared.items, ctx.rules[declared.regime], ctx.metro);
  const monthsLeft = toCome + 1;
  return {
    fy: ctx.fy,
    regime: declared.regime,
    basis: declared.basis,
    projectedGross: Math.round(year.gross),
    taxable: w.taxable,
    annualTax: w.total,
    deductedSoFar: Math.round(paid.tds),
    monthsLeft,
    monthly: monthlyTds(w.total, paid.tds, monthsLeft),
  };
}
