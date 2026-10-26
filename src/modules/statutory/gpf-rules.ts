/**
 * GPF account rules as pure functions (§9) — the ledger screen, the annual statement, the interest credit and the tests
 * share them.
 *
 * Interest (GPF (Central Services) Rules, 1960, rule 11): worked out on the balance at the end of each month. Money
 * recovered from pay counts from the first day of the month it is recovered in; money taken out (advance, withdrawal)
 * stops earning from the month it is taken out. So month by month: interest = balance at the month's end × rate / 12,
 * with the rate in force that month (the Ministry notifies it each quarter). The year's interest is rounded to the
 * rupee and credited on 31 March.
 */
export type GpfKind = "OPENING" | "SUBSCRIPTION" | "REFUND" | "ADVANCE" | "WITHDRAWAL" | "INTEREST";

export interface GpfMove {
  month: string;
  fy: string;
  kind: GpfKind;
  /** Credit positive, debit negative. */
  amount: number;
}

const paise = (n: number) => Math.round(n * 100);
const rupees = (p: number) => p / 100;

/** Balance after every move up to and including a month. */
export function gpfBalance(moves: GpfMove[], upToMonth = "9999-12"): number {
  return rupees(moves.filter((m) => m.month <= upToMonth).reduce((s, m) => s + paise(m.amount), 0));
}

/** The twelve months of a financial year: "2026-27" → 2026-04 … 2027-03. */
export function monthsOfFy(fy: string): string[] {
  const start = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = 4 + i;
    return m <= 12 ? `${start}-${String(m).padStart(2, "0")}` : `${start + 1}-${String(m - 12).padStart(2, "0")}`;
  });
}

export interface GpfMonth {
  month: string;
  /** Subscriptions and advance refunds credited this month. */
  credits: number;
  /** Advances and withdrawals paid out this month (positive figure). */
  debits: number;
  balance: number;
  rate: number;
  interest: number;
}

export interface GpfYear {
  fy: string;
  opening: number;
  months: GpfMonth[];
  credits: number;
  debits: number;
  /** Worked out by the rule above, to the rupee. */
  interest: number;
  /** Interest already credited for this year (0 until 31 March). */
  interestCredited: number;
  closing: number;
}

/**
 * One year of a GPF account. `rateFor(month)` gives the interest rate (% a year) in force in a month; `untilMonth`
 * stops the working early (a final payment on retirement earns interest to the month before payment).
 */
export function gpfYear(moves: GpfMove[], fy: string, rateFor: (month: string) => number, untilMonth?: string): GpfYear {
  const before = moves.filter((m) => m.fy < fy);
  const inYear = moves.filter((m) => m.fy === fy && m.kind !== "INTEREST" && m.kind !== "OPENING");
  // An opening balance brought from the old system with this year's date counts from the year's start.
  const openingThisYear = moves.filter((m) => m.fy === fy && m.kind === "OPENING");
  const opening = paise(gpfBalance(before)) + openingThisYear.reduce((s, m) => s + paise(m.amount), 0);
  let balance = opening;
  let interestPaise = 0;
  let credits = 0;
  let debits = 0;
  const months: GpfMonth[] = [];
  for (const month of monthsOfFy(fy)) {
    if (untilMonth && month > untilMonth) break;
    const here = inYear.filter((m) => m.month === month);
    const c = here.filter((m) => m.amount > 0).reduce((s, m) => s + paise(m.amount), 0);
    const d = here.filter((m) => m.amount < 0).reduce((s, m) => s - paise(m.amount), 0);
    balance += c - d;
    credits += c;
    debits += d;
    const rate = rateFor(month);
    const interest = (Math.max(0, balance) * rate) / 1200;
    interestPaise += interest;
    months.push({ month, credits: rupees(c), debits: rupees(d), balance: rupees(balance), rate, interest: Math.round(interest) / 100 });
  }
  const interest = Math.round(interestPaise / 100);
  const interestCredited = rupees(moves.filter((m) => m.fy === fy && m.kind === "INTEREST").reduce((s, m) => s + paise(m.amount), 0));
  return { fy, opening: rupees(opening), months, credits: rupees(credits), debits: rupees(debits), interest, interestCredited, closing: rupees(balance) + interestCredited };
}

/** Most that may be taken out: a share of the balance (advance 75%, withdrawal 90% by default — dated rates). */
export function gpfLimit(balance: number, percent: number): number {
  return Math.max(0, Math.floor((balance * percent) / 100));
}

/** Refundable advance: equal instalments rounded up to the rupee (12 to 60 by the rules); the last takes what is left. */
export function gpfInstalment(amount: number, instalments: number): number {
  return Math.ceil(amount / instalments);
}

/** What an advance recovers in a month: one instalment, or what is left if less. */
export function gpfRefundDue(amount: number, instalment: number, recovered: number): number {
  return Math.max(0, Math.min(instalment, rupees(paise(amount) - paise(recovered))));
}
