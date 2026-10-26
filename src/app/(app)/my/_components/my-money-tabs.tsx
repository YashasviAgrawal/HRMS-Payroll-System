import { LinkTabs } from "@/components/ui/tabs";
import type { TFunction } from "@/lib/i18n";

/** "Payslips and Form 16" (PRD §13): payslips, my tax declaration (S-51) and my GPF / NPS (S-50) in one place. */
export function MyMoneyTabs({ active, t }: { active: "payslips" | "tax" | "funds"; t: TFunction }) {
  return (
    <LinkTabs
      className="mb-5"
      active={active}
      tabs={[
        { key: "payslips", label: t("statutory.my.tabs.payslips"), href: "/my/payslips" },
        { key: "tax", label: t("statutory.my.tabs.tax"), href: "/my/tax" },
        { key: "funds", label: t("statutory.my.tabs.funds"), href: "/my/funds" },
      ]}
    />
  );
}
