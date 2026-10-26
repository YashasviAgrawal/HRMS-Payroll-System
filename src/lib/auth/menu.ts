/**
 * Menus per login — PRD §13. Each login sees at most 8 items, and only the screens its ticked
 * permissions allow. Pure module: icons are names, resolved to components by the sidebar.
 */
import { can, rolesOf, type Principal } from "./access";

export type MenuIcon =
  | "home"
  | "inbox"
  | "wallet"
  | "chart"
  | "users"
  | "scale"
  | "settings"
  | "history"
  | "idcard"
  | "briefcase"
  | "calendar"
  | "landmark"
  | "receipt"
  | "heart"
  | "user"
  | "send"
  | "team"
  | "fingerprint"
  | "leaf";

export interface MenuItem {
  key: string;
  href: string;
  icon: MenuIcon;
}

type Rule = (p: Principal) => boolean;

interface MenuDef extends MenuItem {
  show: Rule;
}

const always: Rule = () => true;
const hasPerm =
  (...perms: string[]): Rule =>
  (p) =>
    p.permissions.some((x) => perms.includes(x));

const ADMIN_MENU: MenuDef[] = [
  { key: "home", href: "/home", icon: "home", show: always },
  { key: "approvals", href: "/approvals", icon: "inbox", show: hasPerm("APPROVER", "PAY_BILL_SIGNER") },
  { key: "payrollSign", href: "/payroll", icon: "wallet", show: hasPerm("APPROVER", "PAY_BILL_SIGNER") },
  { key: "reports", href: "/reports", icon: "chart", show: (p) => can(p, "reports", "view") },
  { key: "users", href: "/admin/users", icon: "users", show: (p) => can(p, "users_settings", "view") },
  { key: "rates", href: "/admin/rates", icon: "scale", show: (p) => can(p, "rates_rules", "approve") },
  { key: "settings", href: "/admin/settings", icon: "settings", show: hasPerm("USER_SETTINGS_MANAGER") },
  { key: "audit", href: "/admin/audit", icon: "history", show: (p) => can(p, "audit_trail", "view") },
];

const HR_MENU: MenuDef[] = [
  { key: "home", href: "/home", icon: "home", show: always },
  { key: "employees", href: "/employees", icon: "idcard", show: (p) => can(p, "employee_master", "view") },
  { key: "recruitment", href: "/recruitment", icon: "briefcase", show: (p) => can(p, "recruitment", "view") },
  {
    key: "attendanceLeave",
    href: "/attendance",
    icon: "calendar",
    show: (p) => can(p, "attendance", "view") || can(p, "leave", "view"),
  },
  { key: "payroll", href: "/payroll", icon: "wallet", show: (p) => can(p, "payroll", "view") },
  { key: "statutory", href: "/statutory", icon: "landmark", show: (p) => can(p, "statutory", "view") },
  { key: "pension", href: "/pension", icon: "leaf", show: (p) => can(p, "pension", "view") },
  { key: "reports", href: "/reports", icon: "chart", show: (p) => can(p, "reports", "view") },
];

const EMPLOYEE_MENU: MenuDef[] = [
  { key: "home", href: "/home", icon: "home", show: always },
  { key: "payslips", href: "/my/payslips", icon: "receipt", show: always },
  { key: "leave", href: "/leave", icon: "calendar", show: always },
  { key: "attendance", href: "/my/attendance", icon: "fingerprint", show: always },
  { key: "myRecord", href: "/my/record", icon: "user", show: always },
  { key: "requests", href: "/my/requests", icon: "send", show: always },
  { key: "myTeam", href: "/my/team", icon: "team", show: hasPerm("REPORTING_OFFICER") },
];

const PENSIONER_MENU: MenuDef[] = [
  { key: "home", href: "/home", icon: "home", show: always },
  { key: "pensionSlips", href: "/my/pension-slips", icon: "receipt", show: always },
  { key: "lifeCertificate", href: "/my/life-certificate", icon: "heart", show: always },
  { key: "myRecord", href: "/my/record", icon: "user", show: always },
];

export const MAX_MENU_ITEMS = 8;

export function menuFor(p: Principal): MenuItem[] {
  let defs: MenuDef[];
  if (p.loginType === "ADMIN") defs = ADMIN_MENU;
  else if (p.loginType === "HR_ACCOUNTS") defs = HR_MENU;
  else if (rolesOf(p).includes("EMPLOYEE")) defs = EMPLOYEE_MENU;
  else defs = PENSIONER_MENU;
  return defs
    .filter((d) => d.show(p))
    .slice(0, MAX_MENU_ITEMS)
    .map(({ key, href, icon }) => ({ key, href, icon }));
}

/** Who has an approvals inbox at all (S-04: Admin; HR & A Checker; Employee reporting officer). */
export function hasApprovalsInbox(p: Principal): boolean {
  return p.permissions.some((x) =>
    ["APPROVER", "PAY_BILL_SIGNER", "CHECKER", "REPORTING_OFFICER", "HR", "PAYROLL", "PENSION"].includes(x),
  );
}
