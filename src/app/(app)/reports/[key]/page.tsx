import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, FileSpreadsheet, FileText, SearchX } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { cellText, colLabel, isNumeric, totalsOf } from "@/modules/reports/present";
import { reportDef, reportScope, runReport } from "@/modules/reports/registry";

export const metadata: Metadata = { title: "Report" };

const TYPES = ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION", "CONTRACT", "DAILY_WAGE", "REEMPLOYED"] as const;
/** The screen shows this many rows; Excel and PDF always carry them all. */
const SCREEN_ROWS = 1000;
/** Register codes read at a glance: absences in red, late and half days in amber, offs muted. */
const DAY_TONE: Record<string, string> = { A: "text-red-700 font-semibold", DN: "text-red-700 font-semibold", L: "text-amber-700", "½": "text-amber-700", M: "text-amber-700", LV: "text-sky-700", OD: "text-sky-700", W: "text-ink-400", H: "text-ink-400", "–": "text-ink-300" };

/** S-70: one standard report — filters, the table with totals, and Excel / PDF downloads of exactly what is shown. */
export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ month?: string; section?: string; type?: string }> }) {
  const actor = await requireActor();
  const { key } = await params;
  const def = reportDef(key);
  if (!def) notFound();
  if (!reportScope(actor, def)) return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const ran = await runReport(actor, key, sp);
  const { columns, rows, note, links } = ran.result;
  const totals = totalsOf(ran.result);
  const sections = def.filters.includes("section")
    ? await db.section.findMany({ where: { boardId: actor.boardId, isActive: true, ...(ran.lockedSectionId ? { id: ran.lockedSectionId } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true, nameHi: true } })
    : [];
  const query = new URLSearchParams({ month: ran.filters.month, ...(ran.filters.sectionId && !ran.lockedSectionId ? { section: ran.filters.sectionId } : {}), ...(ran.filters.type ? { type: ran.filters.type } : {}) });
  const title = `${def.no}. ${tDynamic(t, `reports.titles.r${def.no}`)}`;
  const shown = rows.slice(0, SCREEN_ROWS);
  const labels = columns.map((c) => colLabel(c, t, locale));
  // Wide reports keep the first column (who) in view while the rest scrolls.
  const pin = columns.length > 9 ? "sm:sticky sm:left-0 sm:z-[1] sm:shadow-[1px_0_0_var(--color-ink-100)]" : "";

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: t("reports.title"), href: "/reports" }, { label: tDynamic(t, `reports.areas.${def.area}`) }]}
        title={title}
        description={tDynamic(t, `reports.descs.r${def.no}`)}
        actions={
          <>
            <a href={`/api/v1/reports/${def.key}/export?format=xlsx&${query}`} className={buttonClass("secondary")}>
              <FileSpreadsheet className="size-4 text-brand-700" aria-hidden="true" /> {t("reports.excel")}
            </a>
            <a href={`/api/v1/reports/${def.key}/export?format=pdf&${query}`} target="_blank" rel="noopener" className={buttonClass("secondary")}>
              <FileText className="size-4 text-red-700" aria-hidden="true" /> {t("reports.pdf")}
            </a>
          </>
        }
      />

      <Card className="mb-5">
        <form method="get" className="flex flex-wrap items-end gap-3 px-5 py-4 sm:px-6" aria-label={t("reports.filters")}>
          {def.filters.includes("month") && (
            <label className="grid gap-1.5 text-sm font-medium text-ink-800">
              {t("reports.month")}
              <input type="month" name="month" defaultValue={ran.filters.month} required className={controlClass(false, "h-10 w-auto")} />
            </label>
          )}
          {def.filters.includes("section") && (
            <label className="grid min-w-[12rem] gap-1.5 text-sm font-medium text-ink-800">
              {t("reports.section")}
              {ran.lockedSectionId ? (
                <select disabled className={controlClass(false, "h-10")} aria-describedby="own-section">
                  <option>{sections[0] ? (locale === "hi" ? sections[0].nameHi : sections[0].name) : "—"}</option>
                </select>
              ) : (
                <select name="section" defaultValue={ran.filters.sectionId ?? ""} className={controlClass(false, "h-10")}>
                  <option value="">{t("reports.allSections")}</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {locale === "hi" ? s.nameHi : s.name}
                    </option>
                  ))}
                </select>
              )}
            </label>
          )}
          {def.filters.includes("type") && (
            <label className="grid min-w-[12rem] gap-1.5 text-sm font-medium text-ink-800">
              {t("reports.type")}
              <select name="type" defaultValue={ran.filters.type ?? ""} className={controlClass(false, "h-10")}>
                <option value="">{t("reports.allTypes")}</option>
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {tDynamic(t, `employees.type.${ty}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className={buttonClass("primary")}>
            {t("reports.show")}
          </button>
          {ran.lockedSectionId && (
            <p id="own-section" className="basis-full text-xs text-ink-500">
              {t("reports.ownSection")}
            </p>
          )}
        </form>
      </Card>

      {note && <p className="mb-4 max-w-4xl text-sm text-ink-600">{locale === "hi" ? note.hi : note.en}</p>}
      {links && links.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {links.map((l) => (
            <a key={l.href} href={l.href} target={l.href.startsWith("/api/") ? "_blank" : undefined} rel="noopener" className={buttonClass("subtle", "sm", "h-auto! min-h-8 max-w-full whitespace-normal py-1.5 text-left")}>
              {locale === "hi" ? l.labelHi : l.label} <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          ))}
        </div>
      )}

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<SearchX className="size-6" aria-hidden="true" />} title={t("reports.nothing")} description={t("reports.nothingHelp")} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-5 py-3 text-sm text-ink-500 sm:px-6">
              <span>{t("reports.rowsCount", { n: rows.length })}</span>
              {rows.length > SCREEN_ROWS && <span>{t("reports.firstRows", { n: SCREEN_ROWS })}</span>}
            </div>
            <Table stack>
              <THead>
                <tr>
                  {columns.map((c, i) => (
                    <Th key={c.key} align={isNumeric(c) && !c.enumKey ? "right" : "left"} className={cn(/^d\d\d$/.test(c.key) && "px-1.5! text-center", i === 0 && pin && `${pin} sm:bg-ink-50`)}>
                      {labels[i]}
                    </Th>
                  ))}
                </tr>
              </THead>
              <tbody>
                {shown.map((r, ri) => (
                  <Tr key={ri} className={cn(r._tone === "red" && "bg-red-50/60", r._tone === "amber" && "bg-amber-50/60")}>
                    {columns.map((c, i) => {
                      const text = cellText(c, r, t, locale);
                      const day = /^d\d\d$/.test(c.key);
                      return (
                        <Td key={c.key} label={labels[i]} align={isNumeric(c) && !c.enumKey ? "right" : "left"} className={cn(day ? cn("px-1.5! text-center text-xs", DAY_TONE[text]) : "sm:whitespace-nowrap", c.key === "detail" || c.key === "moved" || c.key === "heads" ? "sm:whitespace-normal sm:min-w-[12rem]" : "", i === 0 && pin && `${pin} sm:bg-white`)}>
                          {i === 0 && r._href ? (
                            <Link href={r._href} className="font-medium text-brand-700 hover:underline">
                              {text || "—"}
                            </Link>
                          ) : (
                            text || (day ? "" : "—")
                          )}
                        </Td>
                      );
                    })}
                  </Tr>
                ))}
                {totals && rows.length <= SCREEN_ROWS && (
                  <tr className="bg-brand-50/70 font-semibold text-ink-900">
                    {columns.map((c, i) => (
                      <Td key={c.key} label={labels[i]} align={isNumeric(c) && !c.enumKey ? "right" : "left"} className={cn("sm:whitespace-nowrap", !c.total && i > 0 && "max-sm:hidden")}>
                        {c.total ? cellText(c, totals, t, locale) : i === 0 ? t("reports.total") : ""}
                      </Td>
                    ))}
                  </tr>
                )}
              </tbody>
            </Table>
          </>
        )}
      </Card>
    </div>
  );
}
