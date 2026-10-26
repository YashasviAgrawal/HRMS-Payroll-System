import { LinkTabs } from "@/components/ui/tabs";
import { canAll, type Principal } from "@/lib/auth/access";
import type { TFunction } from "@/lib/i18n";

export type PayrollTab = "runs" | "items" | "increments" | "arrears" | "loans" | "payslips";

/** The areas of the payroll screen this person may open (S-40 to S-44). */
export function payrollTabs(p: Principal): PayrollTab[] {
  const tabs: PayrollTab[] = ["runs"];
  if (canAll(p, "payroll", "create") || p.permissions.includes("CHECKER")) tabs.push("items");
  if (canAll(p, "payroll", "view") || canAll(p, "service_book", "create")) tabs.push("increments");
  if (canAll(p, "arrears_loans", "view")) tabs.push("arrears", "loans");
  if (canAll(p, "payroll", "view")) tabs.push("payslips");
  return tabs;
}

const HREF: Record<PayrollTab, string> = {
  runs: "/payroll",
  items: "/payroll/items",
  increments: "/payroll/increments",
  arrears: "/payroll/arrears",
  loans: "/payroll/loans",
  payslips: "/payroll/payslips",
};

export function PayrollTabs({ active, principal, t }: { active: PayrollTab; principal: Principal; t: TFunction }) {
  const tabs = payrollTabs(principal);
  if (tabs.length < 2) return null;
  return <LinkTabs className="mb-5" active={active} tabs={tabs.map((k) => ({ key: k, label: t(`payroll.tabs.${k}`), href: HREF[k] }))} />;
}
