import { LinkTabs } from "@/components/ui/tabs";
import type { TFunction } from "@/lib/i18n";

export type PensionTab = "bills" | "pensioners" | "certificates" | "cases";

const HREF: Record<PensionTab, string> = {
  bills: "/pension",
  pensioners: "/pension/pensioners",
  certificates: "/pension/life-certificates",
  cases: "/pension/cases",
};

/** S-60 to S-62: the areas of the Pension screen. */
export function PensionTabs({ active, t }: { active: PensionTab; t: TFunction }) {
  return <LinkTabs className="mb-5" active={active} tabs={(Object.keys(HREF) as PensionTab[]).map((k) => ({ key: k, label: t(`pension.tabs.${k}`), href: HREF[k] }))} />;
}

/** Life certificate status colours. */
export const LC_TONE = { VALID: "green", DUE_SOON: "amber", OVERDUE: "red", HELD: "red" } as const;
export const CASE_TONE = { DRAFT: "gray", CHECKING: "amber", APPROVING: "amber", APPROVED: "green", REJECTED: "red" } as const;
