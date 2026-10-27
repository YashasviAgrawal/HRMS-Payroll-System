/**
 * PR-09 loans and advances as pure rules. The principal is recovered first in equal monthly instalments (the last one
 * only what is left); simple interest runs on the principal still due at the start of each month until it is repaid,
 * and is then recovered in instalments of the same size. Recovery stops at zero.
 */
import { shiftMonth } from "@/lib/dates";
import { fromPaise, roundPaiseToRupee, toPaise } from "@/lib/money";

export interface LoanTerms {
  principal: number;
  /** % a year. */
  interestRate: number;
  instalmentAmount: number;
  startMonth: string;
  /** Interest already owed when the loan was brought from the old system (§15 step 8). */
  openingInterest?: number;
}

const amount = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** The terms of a saved loan (Decimal fields as numbers). */
export function loanTermsOf(l: { principal: unknown; interestRate: unknown; instalmentAmount: unknown; startMonth: string; openingInterest?: unknown }): LoanTerms {
  return { principal: amount(l.principal), interestRate: amount(l.interestRate), instalmentAmount: amount(l.instalmentAmount), startMonth: l.startMonth, openingInterest: amount(l.openingInterest) };
}

export interface Recovered {
  month: string;
  principal: number;
  interest: number;
}

export interface LoanPosition {
  principalLeft: number;
  /** Interest owed so far (rounded to the rupee) less interest recovered. */
  interestLeft: number;
  interestTotal: number;
  /** What this month's payroll recovers. */
  due: { principal: number; interest: number };
  closed: boolean;
}

/** The loan as it stands for a month, from the recoveries of earlier months. */
export function loanPosition(terms: LoanTerms, recovered: Recovered[], month: string): LoanPosition {
  const before = recovered.filter((r) => r.month < month);
  const principal = toPaise(terms.principal);
  const paidPrincipal = before.reduce((s, r) => s + toPaise(r.principal), 0);
  const paidInterest = before.reduce((s, r) => s + toPaise(r.interest), 0);
  const principalLeft = Math.max(0, principal - paidPrincipal);

  // Interest on the principal outstanding at the start of each month from the start month to this one (or until the
  // principal was repaid). Months with no recovery still carry interest.
  let accrued = 0;
  if (terms.interestRate > 0) {
    const byMonth = new Map<string, number>();
    for (const r of recovered) byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + toPaise(r.principal));
    let outstanding = principal;
    for (let m = terms.startMonth; m <= month && outstanding > 0; m = shiftMonth(m, 1)) {
      if (m === month && principalLeft === 0) break;
      accrued += (outstanding * terms.interestRate) / 1200;
      outstanding -= byMonth.get(m) ?? 0;
    }
  }
  const interestTotal = roundPaiseToRupee(accrued) + toPaise(terms.openingInterest ?? 0);
  const interestLeft = Math.max(0, interestTotal - paidInterest);
  const instalment = toPaise(terms.instalmentAmount);
  const started = month >= terms.startMonth;
  const due = !started
    ? { principal: 0, interest: 0 }
    : principalLeft > 0
      ? { principal: Math.min(instalment, principalLeft), interest: 0 }
      : { principal: 0, interest: Math.min(instalment, interestLeft) };
  return {
    principalLeft: fromPaise(principalLeft),
    interestLeft: fromPaise(interestLeft),
    interestTotal: fromPaise(interestTotal),
    due: { principal: fromPaise(due.principal), interest: fromPaise(due.interest) },
    closed: principalLeft === 0 && interestLeft === 0,
  };
}

/** The schedule if every instalment is recovered on time — shown when the loan is sanctioned. */
export function loanSchedule(terms: LoanTerms, maxMonths = 600): { month: string; principal: number; interest: number; principalLeft: number }[] {
  const rows: { month: string; principal: number; interest: number; principalLeft: number }[] = [];
  const recovered: Recovered[] = [];
  for (let m = terms.startMonth, i = 0; i < maxMonths; m = shiftMonth(m, 1), i++) {
    const pos = loanPosition(terms, recovered, m);
    if (pos.closed) break;
    if (pos.due.principal === 0 && pos.due.interest === 0) break;
    recovered.push({ month: m, principal: pos.due.principal, interest: pos.due.interest });
    rows.push({ month: m, principal: pos.due.principal, interest: pos.due.interest, principalLeft: Math.max(0, pos.principalLeft - pos.due.principal) });
  }
  return rows;
}
