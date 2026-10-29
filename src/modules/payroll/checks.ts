/**
 * PR-10 pre-checks, as pure rules shared by the payroll run, the screens and the tests.
 *
 * BLOCK — the run cannot go to the Checker until each one is fixed (correct the record and work the payroll out
 * again) or resolved (the person's pay withheld, or the reason recorded). WARN — a remark the Checker reads.
 */
export type ExceptionCode =
  | "NO_BANK"
  | "NEGATIVE_NET"
  | "AFTER_RETIREMENT"
  | "DUPLICATE_BANK"
  | "NO_PAY_LEVEL"
  | "SUSPENDED"
  | "ATTENDANCE_NOT_LOCKED"
  | "NET_CHANGE"
  | "LIFE_CERTIFICATE"
  | "LEAVING_WITH_LOAN";

export type Resolution = "EXPLAINED" | "WITHHELD" | "WAIVED";

export const EXCEPTION_RULES: Record<ExceptionCode, { severity: "BLOCK" | "WARN"; resolutions: Resolution[] }> = {
  NO_BANK: { severity: "BLOCK", resolutions: ["WITHHELD"] },
  NEGATIVE_NET: { severity: "BLOCK", resolutions: ["WITHHELD"] },
  AFTER_RETIREMENT: { severity: "BLOCK", resolutions: ["WITHHELD"] },
  DUPLICATE_BANK: { severity: "BLOCK", resolutions: ["EXPLAINED", "WITHHELD"] },
  NO_PAY_LEVEL: { severity: "BLOCK", resolutions: ["WITHHELD"] },
  // Subsistence allowance during suspension is paid through a supplementary bill.
  SUSPENDED: { severity: "BLOCK", resolutions: ["WITHHELD"] },
  // One per section: pay without last month's loss days (they are recovered next month), or hold the section's pay.
  ATTENDANCE_NOT_LOCKED: { severity: "BLOCK", resolutions: ["WAIVED", "WITHHELD"] },
  NET_CHANGE: { severity: "WARN", resolutions: ["EXPLAINED"] },
  // PN-06: a pension is held once the life certificate is more than a month overdue (the system withholds it).
  LIFE_CERTIFICATE: { severity: "BLOCK", resolutions: ["WITHHELD"] },
  // Client add-on: the last pay of a person leaving this month with a loan still owed — hold it, and the full and final
  // settlement takes it as a due and recovers the loan from it; or pay it, with the reason recorded.
  LEAVING_WITH_LOAN: { severity: "BLOCK", resolutions: ["WITHHELD", "EXPLAINED"] },
};

export const EXCEPTION_CODES = Object.keys(EXCEPTION_RULES) as ExceptionCode[];

/** PR-10: net pay that moves more than this against last month is shown to the Checker. */
export const NET_CHANGE_LIMIT_PCT = 25;

/** Percentage change of net pay against last month, to two decimals; null when there is nothing to compare. */
export function changePct(net: number, lastNet: number | null | undefined): number | null {
  if (lastNet === null || lastNet === undefined || lastNet <= 0) return null;
  return Math.round(((net - lastNet) / lastNet) * 10_000) / 100;
}

export interface SlipFacts {
  employeeId: string;
  net: number;
  lastNet: number | null;
  hasBank: boolean;
  bankHash: string | null;
  afterRetirement: boolean;
  noPayLevel: boolean;
  suspended: boolean;
  /** Leaves service this month: the last day and what the loans still owe after this month's instalment. */
  leaving?: { lastDay: string; loansLeft: number } | null;
}

export interface Found {
  employeeId: string | null;
  code: ExceptionCode;
  vars: Record<string, string | number>;
  /** Resolved by a rule rather than a person (a pension held for a missing life certificate). */
  resolved?: { resolution: Resolution; note: string };
}

/**
 * The per-person checks. `bankHolders` counts, for each bank account (blind index), how many people on the rolls
 * hold it — across every pay group, so a duplicate between an OPS and a contract worker is caught too.
 */
export function preChecks(slips: SlipFacts[], bankHolders: Map<string, number>): Found[] {
  const out: Found[] = [];
  for (const s of slips) {
    const add = (code: ExceptionCode, vars: Record<string, string | number> = {}) => out.push({ employeeId: s.employeeId, code, vars });
    if (s.suspended) add("SUSPENDED");
    if (s.noPayLevel) add("NO_PAY_LEVEL");
    if (s.afterRetirement) add("AFTER_RETIREMENT");
    if (!s.hasBank) add("NO_BANK");
    else if (s.bankHash && (bankHolders.get(s.bankHash) ?? 0) > 1) add("DUPLICATE_BANK", { holders: bankHolders.get(s.bankHash)! });
    if (s.net < 0) add("NEGATIVE_NET", { net: s.net });
    const pct = changePct(s.net, s.lastNet);
    if (pct !== null && Math.abs(pct) > NET_CHANGE_LIMIT_PCT) add("NET_CHANGE", { pct, lastNet: s.lastNet ?? 0, net: s.net });
    if (s.leaving && s.leaving.loansLeft > 0) add("LEAVING_WITH_LOAN", { lastDay: s.leaving.lastDay, amount: s.leaving.loansLeft });
  }
  return out;
}

/** Key used to carry a resolution over when the payroll is worked out again. */
export function exceptionKey(e: { employeeId: string | null; code: string; vars?: unknown }): string {
  const v = (e.vars ?? {}) as Record<string, unknown>;
  return `${e.employeeId ?? ""}|${e.code}|${String(v.sectionId ?? "")}`;
}
