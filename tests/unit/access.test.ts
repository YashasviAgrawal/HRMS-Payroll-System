import { describe, expect, it } from "vitest";
import type { LoginType, Permission } from "@/generated/prisma/enums";
import { can, canSeeSensitive, permissionConflicts, scopeFor, type Action, type Fn, type Principal } from "@/lib/auth/access";
import { adminTools, MAX_MENU_ITEMS, menuFor } from "@/lib/auth/menu";

/**
 * PRD §14 access matrix, typed in again by hand from the document so the coded matrix is checked against
 * an independent copy. Key: C create/edit · K check · A approve · V view · O own · S own section · "" none.
 */
type Col = "APPROVER" | "USER_SETTINGS_MANAGER" | "HR" | "PAYROLL" | "PENSION" | "CHECKER" | "EMPLOYEE" | "REPORTING_OFFICER" | "PENSIONER";
const PRD: Record<Fn, Partial<Record<Col, string>>> = {
  employee_master: { APPROVER: "V", HR: "C", PAYROLL: "V", PENSION: "V", CHECKER: "K", EMPLOYEE: "O", REPORTING_OFFICER: "S(view)" },
  service_book: { APPROVER: "A", HR: "C", PAYROLL: "V", PENSION: "V", CHECKER: "K", EMPLOYEE: "O" },
  recruitment: { APPROVER: "A", HR: "C", PAYROLL: "C", CHECKER: "K" },
  attendance: { APPROVER: "V", HR: "C", PAYROLL: "V", CHECKER: "K", EMPLOYEE: "O", REPORTING_OFFICER: "A+lock(S)" },
  leave: { APPROVER: "A", HR: "C", PAYROLL: "V", EMPLOYEE: "C(apply),O", REPORTING_OFFICER: "A(S)" },
  payroll: { APPROVER: "A+sign", PAYROLL: "C", CHECKER: "K", EMPLOYEE: "O" },
  arrears_loans: { APPROVER: "A", PAYROLL: "C", CHECKER: "K", EMPLOYEE: "O" },
  statutory: { APPROVER: "A", PAYROLL: "C", CHECKER: "K", EMPLOYEE: "O" },
  pension: { APPROVER: "A", PENSION: "C", CHECKER: "K", PENSIONER: "O" },
  rates_rules: { APPROVER: "A", HR: "C", PAYROLL: "C", PENSION: "C" },
  reports: { APPROVER: "V", HR: "V", PAYROLL: "V", PENSION: "V", CHECKER: "V", REPORTING_OFFICER: "S" },
  audit_trail: { APPROVER: "V", USER_SETTINGS_MANAGER: "V(system)" },
  users_settings: { APPROVER: "V", USER_SETTINGS_MANAGER: "C" },
  migration: { APPROVER: "A", USER_SETTINGS_MANAGER: "C", HR: "C", PAYROLL: "C", PENSION: "C", CHECKER: "K", EMPLOYEE: "O", PENSIONER: "O" },
};

function principalFor(col: Col): Principal {
  const loginOf: Record<Col, LoginType> = {
    APPROVER: "ADMIN",
    USER_SETTINGS_MANAGER: "ADMIN",
    HR: "HR_ACCOUNTS",
    PAYROLL: "HR_ACCOUNTS",
    PENSION: "HR_ACCOUNTS",
    CHECKER: "HR_ACCOUNTS",
    EMPLOYEE: "EMPLOYEE",
    REPORTING_OFFICER: "EMPLOYEE",
    PENSIONER: "EMPLOYEE",
  };
  // The PRD merges "Approver / Signer" into one column, so that column holds both permissions.
  const perms: Permission[] =
    col === "EMPLOYEE" || col === "PENSIONER" ? [] : col === "APPROVER" ? ["APPROVER", "PAY_BILL_SIGNER"] : [col as Permission];
  return { loginType: loginOf[col], permissions: perms, isEmployee: col === "EMPLOYEE" || col === "REPORTING_OFFICER", isPensioner: col === "PENSIONER" };
}

/** What the PRD letter means for this column alone (reporting officers are also employees, tested separately). */
function expected(cell: string | undefined): Partial<Record<Action, string>> {
  if (!cell) return {};
  const out: Partial<Record<Action, string>> = {};
  if (cell.startsWith("C")) out.create = "all";
  if (cell === "C(apply),O") out.create = "own";
  if (cell.startsWith("K")) out.check = "all";
  if (cell.startsWith("A")) out.approve = cell.includes("(S)") ? "section" : "all";
  if (cell.includes("sign")) out.sign = "all";
  if (cell.includes("lock(S)")) out.lock = "section";
  if (cell.startsWith("V")) out.view = cell.includes("system") ? "system" : "all";
  if (cell === "O" || cell.endsWith(",O")) out.view = "own";
  if (cell.startsWith("S")) out.view = "section";
  return out;
}

describe("access matrix (PRD §14)", () => {
  const cols: Col[] = ["APPROVER", "USER_SETTINGS_MANAGER", "HR", "PAYROLL", "PENSION", "CHECKER", "EMPLOYEE", "PENSIONER"];
  for (const fn of Object.keys(PRD) as Fn[]) {
    for (const col of cols) {
      it(`${fn} × ${col} = "${PRD[fn][col] ?? ""}"`, () => {
        const p = principalFor(col);
        const exp = expected(PRD[fn][col]);
        for (const [action, scope] of Object.entries(exp)) {
          expect(scopeFor(p, fn, action as Action), `${action}`).toBe(scope);
        }
        if (!PRD[fn][col]) {
          for (const action of ["view", "create", "check", "approve"] as Action[]) {
            if (col === "EMPLOYEE" && fn === "migration") continue;
            expect(scopeFor(p, fn, action), `${action} should be blank`).toBeNull();
          }
        }
      });
    }
  }

  it("reporting officers act only on their own section", () => {
    const ro = principalFor("REPORTING_OFFICER");
    expect(scopeFor(ro, "attendance", "approve")).toBe("section");
    expect(scopeFor(ro, "attendance", "lock")).toBe("section");
    expect(scopeFor(ro, "leave", "approve")).toBe("section");
    expect(scopeFor(ro, "reports", "view")).toBe("section");
    expect(scopeFor(ro, "employee_master", "view")).toBe("section");
    expect(can(ro, "payroll", "approve")).toBe(false);
  });

  it("permissions from another login are ignored", () => {
    const p: Principal = { loginType: "EMPLOYEE", permissions: ["APPROVER"], isEmployee: true, isPensioner: false };
    expect(can(p, "payroll", "approve")).toBe(false);
  });

  it("the User & settings manager never sees pay, bank or Aadhaar (rule 3)", () => {
    expect(canSeeSensitive(principalFor("USER_SETTINGS_MANAGER"))).toBe(false);
    expect(canSeeSensitive(principalFor("APPROVER"))).toBe(true);
    expect(permissionConflicts(["USER_SETTINGS_MANAGER", "APPROVER"])).toBe("settings_manager_conflict");
    expect(permissionConflicts(["APPROVER", "PAY_BILL_SIGNER"])).toBeNull();
  });
});

describe("menus (PRD §13)", () => {
  const all = (login: LoginType, perms: Permission[], isEmployee = false, isPensioner = false) =>
    menuFor({ loginType: login, permissions: perms, isEmployee, isPensioner }).map((m) => m.key);

  it("an Admin sees every area of the Board, with the admin tools behind one Administration item (client add-on)", () => {
    expect(all("ADMIN", ["APPROVER", "PAY_BILL_SIGNER"])).toEqual(["home", "approvals", "employees", "attendanceLeave", "payrollSign", "pension", "reports", "admin"]);
    expect(adminTools({ loginType: "ADMIN", permissions: ["APPROVER"], isEmployee: false, isPensioner: false }).map((m) => m.key)).toEqual(["statutory", "recruitment", "users", "rates", "migration", "audit"]);
    // The User & settings manager keeps the tools one by one and never sees pay or employee screens.
    expect(all("ADMIN", ["USER_SETTINGS_MANAGER"])).toEqual(["home", "users", "settings", "migration", "audit"]);
    expect(adminTools({ loginType: "HR_ACCOUNTS", permissions: ["HR"], isEmployee: false, isPensioner: false })).toEqual([]);
  });

  it("HR & Accounts sees its 8 items when holding every permission", () => {
    expect(all("HR_ACCOUNTS", ["HR", "PAYROLL", "PENSION", "CHECKER"])).toEqual([
      "home", "employees", "recruitment", "attendanceLeave", "payroll", "statutory", "pension", "reports",
    ]);
    expect(all("HR_ACCOUNTS", ["PENSION"])).toEqual(["home", "employees", "pension", "reports"]);
  });

  it("Employee, reporting officer and pensioner menus", () => {
    expect(all("EMPLOYEE", [], true)).toEqual(["home", "payslips", "leave", "attendance", "myRecord", "requests"]);
    expect(all("EMPLOYEE", ["REPORTING_OFFICER"], true)).toContain("myTeam");
    expect(all("EMPLOYEE", [], false, true)).toEqual(["home", "pensionSlips", "lifeCertificate", "myRecord"]);
  });

  it("never shows more than 8 items", () => {
    for (const login of ["ADMIN", "HR_ACCOUNTS", "EMPLOYEE"] as LoginType[]) {
      const perms: Permission[] = ["APPROVER", "PAY_BILL_SIGNER", "USER_SETTINGS_MANAGER", "HR", "PAYROLL", "PENSION", "CHECKER", "REPORTING_OFFICER"];
      expect(all(login, perms, true).length).toBeLessThanOrEqual(MAX_MENU_ITEMS);
    }
  });
});
