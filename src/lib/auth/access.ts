/**
 * Access matrix — PRD §14, coded cell by cell.
 *
 * "Access follows the permission ticked, not the login alone."
 * Key: C = create or edit · K = check · A = approve · V = view · O = own record only · S = own section only.
 *
 * Pure module (no server imports) so it can be unit-tested and used to build menus.
 */
import type { LoginType, Permission } from "@/generated/prisma/enums";

/** A role is a ticked permission, or the built-in Employee / Pensioner role of the Employee login. */
export type Role = Permission | "EMPLOYEE" | "PENSIONER";

export type Fn =
  | "employee_master"
  | "service_book"
  | "recruitment"
  | "attendance"
  | "leave"
  | "payroll"
  | "arrears_loans"
  | "statutory"
  | "pension"
  | "rates_rules"
  | "reports"
  | "audit_trail"
  | "users_settings"
  | "migration";

export type Action = "view" | "create" | "check" | "approve" | "sign" | "lock";

/** all = whole Board · section = own section only (S) · own = own record only (O) · system = system events only. */
export type Scope = "all" | "section" | "own" | "system";

export interface Grant {
  action: Action;
  scope: Scope;
  /** Free-text limit from the PRD, shown in the Users screen ("appointment, promotion, penalty"). */
  note?: string;
}

const g = (action: Action, scope: Scope = "all", note?: string): Grant => ({ action, scope, note });
const V = (scope: Scope = "all") => g("view", scope);
const C = (note?: string) => g("create", "all", note);
const K = () => g("check");
const A = (note?: string) => g("approve", "all", note);

/** Admin "Approver / Signer" column of §14, shared by the two permissions where the PRD merges them. */
export const ACCESS_MATRIX: Record<Fn, Partial<Record<Role, Grant[]>>> = {
  employee_master: {
    APPROVER: [V()],
    HR: [C(), V()],
    PAYROLL: [V()],
    PENSION: [V()],
    CHECKER: [K(), V()],
    EMPLOYEE: [V("own"), g("create", "own", "change requests (EM-08)")],
    REPORTING_OFFICER: [V("section")],
  },
  service_book: {
    APPROVER: [A("appointment, promotion, penalty"), V()],
    HR: [C(), V()],
    PAYROLL: [V()],
    PENSION: [V()],
    CHECKER: [K(), V()],
    EMPLOYEE: [V("own")],
  },
  recruitment: {
    APPROVER: [A(), V()],
    HR: [C(), V()],
    PAYROLL: [C("initial pay"), V()],
    CHECKER: [K(), V()],
  },
  attendance: {
    APPROVER: [V()],
    HR: [C(), V(), g("lock", "all", "for the section")],
    PAYROLL: [V()],
    CHECKER: [K(), V()],
    EMPLOYEE: [V("own"), g("create", "own", "missed-punch request")],
    REPORTING_OFFICER: [g("approve", "section"), g("lock", "section", "month lock"), V("section")],
  },
  leave: {
    APPROVER: [A("beyond officer's limit"), V()],
    HR: [C("on behalf"), V()],
    PAYROLL: [V()],
    EMPLOYEE: [g("create", "own", "apply"), V("own")],
    REPORTING_OFFICER: [g("approve", "section"), V("section")],
  },
  payroll: {
    APPROVER: [A(), V()],
    PAY_BILL_SIGNER: [g("sign"), V()],
    PAYROLL: [C(), V()],
    CHECKER: [K(), V()],
    EMPLOYEE: [V("own")],
  },
  arrears_loans: {
    APPROVER: [A(), V()],
    PAYROLL: [C(), V()],
    CHECKER: [K(), V()],
    EMPLOYEE: [V("own")],
  },
  statutory: {
    APPROVER: [A("file release"), V()],
    PAYROLL: [C(), V()],
    CHECKER: [K(), V()],
    EMPLOYEE: [g("create", "own", "declarations"), V("own")],
  },
  pension: {
    APPROVER: [A(), V()],
    PAY_BILL_SIGNER: [g("sign"), V()],
    PENSION: [C(), V()],
    CHECKER: [K(), V()],
    PENSIONER: [V("own")],
  },
  rates_rules: {
    APPROVER: [A(), V()],
    HR: [C("propose"), V()],
    PAYROLL: [C("propose"), V()],
    PENSION: [C("propose"), V()],
  },
  reports: {
    APPROVER: [V()],
    PAY_BILL_SIGNER: [V()],
    HR: [V()],
    PAYROLL: [V()],
    PENSION: [V()],
    CHECKER: [V()],
    REPORTING_OFFICER: [V("section")],
  },
  audit_trail: {
    APPROVER: [V()],
    USER_SETTINGS_MANAGER: [V("system")],
  },
  users_settings: {
    APPROVER: [V()],
    USER_SETTINGS_MANAGER: [C(), V()],
  },
  migration: {
    APPROVER: [A("cut-over"), V()],
    USER_SETTINGS_MANAGER: [C("file upload")],
    HR: [C(), V()],
    PAYROLL: [C(), V()],
    PENSION: [C(), V()],
    CHECKER: [K(), V()],
    EMPLOYEE: [V("own"), g("create", "own", "confirm own record")],
    PENSIONER: [V("own"), g("create", "own", "confirm own record")],
  },
};

/** Which permissions each login may hold (PRD §2 table). */
export const PERMISSIONS_BY_LOGIN: Record<LoginType, Permission[]> = {
  ADMIN: ["APPROVER", "PAY_BILL_SIGNER", "USER_SETTINGS_MANAGER"],
  HR_ACCOUNTS: ["HR", "PAYROLL", "PENSION", "CHECKER"],
  EMPLOYEE: ["REPORTING_OFFICER"],
};

export interface Principal {
  loginType: LoginType;
  permissions: readonly Permission[];
  /** True when the Employee login belongs to someone currently on the rolls. */
  isEmployee: boolean;
  /** True when the Employee login belongs to a pensioner (view starts the day after retirement). */
  isPensioner: boolean;
}

export function rolesOf(p: Principal): Role[] {
  const allowed = new Set(PERMISSIONS_BY_LOGIN[p.loginType]);
  const roles: Role[] = p.permissions.filter((perm) => allowed.has(perm));
  if (p.loginType === "EMPLOYEE") {
    if (p.isEmployee) roles.push("EMPLOYEE");
    if (p.isPensioner) roles.push("PENSIONER");
    // Reporting officer only makes sense while the person is on the rolls.
    if (!p.isEmployee) return roles.filter((r) => r !== "REPORTING_OFFICER");
  }
  return roles;
}

const SCOPE_RANK: Record<Scope, number> = { all: 3, section: 2, own: 1, system: 0 };

/**
 * The widest scope the principal has for an action on a function, or null when there is no access.
 * "system" is only ever returned for the audit trail.
 */
export function scopeFor(p: Principal, fn: Fn, action: Action): Scope | null {
  let best: Scope | null = null;
  for (const role of rolesOf(p)) {
    for (const grant of ACCESS_MATRIX[fn][role] ?? []) {
      if (grant.action !== action) continue;
      if (best === null || SCOPE_RANK[grant.scope] > SCOPE_RANK[best]) best = grant.scope;
    }
  }
  return best;
}

export function can(p: Principal, fn: Fn, action: Action): boolean {
  return scopeFor(p, fn, action) !== null;
}

/** True when the principal can do the action Board-wide (not only for their own record or section). */
export function canAll(p: Principal, fn: Fn, action: Action): boolean {
  return scopeFor(p, fn, action) === "all";
}

/**
 * PRD §2 rule 3 and §14 note: the User & settings manager never sees pay, bank or Aadhaar —
 * not on any screen and not in the audit trail.
 */
export function canSeeSensitive(p: Principal): boolean {
  return !p.permissions.includes("USER_SETTINGS_MANAGER");
}

/**
 * Segregation of duties enforced when users are created: the settings manager cannot also approve or
 * sign pay, otherwise rule 3 could never hold for that person.
 */
export function permissionConflicts(perms: readonly Permission[]): string | null {
  const set = new Set(perms);
  if (set.has("USER_SETTINGS_MANAGER") && (set.has("APPROVER") || set.has("PAY_BILL_SIGNER"))) {
    return "settings_manager_conflict";
  }
  return null;
}
