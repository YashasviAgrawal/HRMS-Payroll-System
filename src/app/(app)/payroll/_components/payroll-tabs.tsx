import { LinkTabs } from "@/components/ui/tabs";

/** Payroll month | Pay items — the two areas of the HR & Accounts payroll screen. */
export function PayrollTabs({ active, labels, showItems }: { active: "runs" | "items"; labels: { runs: string; items: string }; showItems: boolean }) {
  if (!showItems) return null;
  return (
    <LinkTabs
      className="mb-5"
      active={active}
      tabs={[
        { key: "runs", label: labels.runs, href: "/payroll" },
        { key: "items", label: labels.items, href: "/payroll/items" },
      ]}
    />
  );
}
