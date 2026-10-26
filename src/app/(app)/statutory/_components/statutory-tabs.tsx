import { LinkTabs } from "@/components/ui/tabs";
import type { TFunction } from "@/lib/i18n";

export type StatutoryTab = "calendar" | "files" | "tds" | "declarations" | "form16" | "funds";

const HREF: Record<StatutoryTab, string> = {
  calendar: "/statutory",
  files: "/statutory/files",
  tds: "/statutory/tds",
  declarations: "/statutory/declarations",
  form16: "/statutory/form16",
  funds: "/statutory/funds",
};

/** S-50 to S-53: the areas of the Statutory and tax screen. */
export function StatutoryTabs({ active, t }: { active: StatutoryTab; t: TFunction }) {
  return <LinkTabs className="mb-5" active={active} tabs={(Object.keys(HREF) as StatutoryTab[]).map((k) => ({ key: k, label: t(`statutory.tabs.${k}`), href: HREF[k] }))} />;
}

export const STATE_TONE = { DONE: "green", OPEN: "amber", OVERDUE: "red", NOTHING: "gray" } as const;
export const FILE_TONE: Record<string, "amber" | "green" | "gray" | "red" | "blue"> = { PREVIEW: "amber", APPROVED: "green", DOWNLOADED: "green", REJECTED: "red", VALIDATED: "blue", INVALID: "red", APPLIED: "green" };
export const DECL_TONE = { NONE: "gray", DRAFT: "gray", SUBMITTED: "amber", VERIFIED: "green", RETURNED: "red" } as const;
/** "stat.nps" → "nps": file kinds as text keys (a dot would read as nesting). */
export const kindKey = (kind: string) => (kind === "tds.24q" ? "tds24q" : kind.replace(/^stat\./, "")) as "nps" | "ecr" | "esic" | "pension" | "tds24q";
