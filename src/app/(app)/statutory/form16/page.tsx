import type { Metadata } from "next";
import { BadgeCheck, FileStack, FileText, Send } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { form16Year } from "@/modules/statutory/form16";
import { ActionButton } from "../_components/action-button";
import { StatutoryTabs } from "../_components/statutory-tabs";
import { PeriodPicker } from "../_components/year-picker";
import { PartAImport } from "./part-a-import";

export const metadata: Metadata = { title: "Form 16" };

/** ST-07, S-53: Form 16 — Part B made here, Part A imported, published to each person once an Admin approves. */
export default async function Form16Page({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "statutory", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const y = await form16Year(actor, (await searchParams).fy);
  const published = y.counts.published > 0;

  return (
    <div>
      <PageHeader title={t("statutory.title")} description={t("statutory.form16.subtitle")} />
      <StatutoryTabs active="form16" t={t} />
      <PeriodPicker options={y.years} active={y.fy} href={(fy) => `/statutory/form16?fy=${fy}`} label={t("statutory.fy")} />
      {!y.yearOver && <p className="mb-4 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900">{t("statutory.form16.draftYear", { fy: y.fy })}</p>}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label={t("statutory.form16.counts.people")} value={y.counts.people} tone="blue" />
        <StatTile label={t("statutory.form16.counts.partB")} value={y.counts.partB} tone={y.counts.partB === y.counts.people && y.counts.people ? "green" : "amber"} />
        <StatTile label={t("statutory.form16.counts.partA")} value={y.counts.partA} tone={y.counts.partA === y.counts.people && y.counts.people ? "green" : "gray"} />
        <StatTile label={t("statutory.form16.counts.published")} value={y.counts.published} tone={published ? "green" : "gray"} />
      </div>
      {y.canManage && !published && y.counts.people > 0 && (
        <Card className="mb-5">
          <CardBody className="flex flex-wrap items-start gap-3">
            <ActionButton url="/api/v1/statutory/form16/part-b" body={{ fy: y.fy }} done={t("statutory.form16.generated", { count: y.counts.people })} variant={y.counts.partB ? "secondary" : "primary"} icon={<FileStack className="size-4" />}>
              {t("statutory.form16.generate")}
            </ActionButton>
            <PartAImport fy={y.fy} />
            {y.waiting ? (
              <Badge tone="amber">{t("statutory.form16.waiting")}</Badge>
            ) : (
              y.yearOver &&
              y.counts.partB === y.counts.people && (
                <ActionButton url="/api/v1/statutory/form16/publish" body={{ fy: y.fy }} done={t("statutory.sentToAdmin")} variant="primary" icon={<Send className="size-4" />}>
                  {t("statutory.form16.publish")}
                </ActionButton>
              )
            )}
          </CardBody>
          <CardBody className="border-t border-ink-100 pt-3 text-xs text-ink-500">{t("statutory.form16.importHelp")}</CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title={`${t("statutory.tabs.form16")} · ${y.fy}`} icon={<FileText className="size-4.5" aria-hidden="true" />} />
        {y.rows.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("statutory.form16.none")}</p>
          </CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("statutory.employee")}</Th>
                <Th>{t("statutory.tax.regime")}</Th>
                <Th align="right">{t("statutory.form16.gross")}</Th>
                <Th align="right">{t("statutory.form16.taxable")}</Th>
                <Th align="right">{t("statutory.form16.tax")}</Th>
                <Th align="right">{t("statutory.form16.tds")}</Th>
                <Th>{t("statutory.my.partB")}</Th>
                <Th>{t("statutory.my.partA")}</Th>
              </tr>
            </THead>
            <tbody>
              {y.rows.map((r) => (
                <Tr key={r.employeeId}>
                  <Td>
                    <span className="font-medium text-ink-900">{locale === "hi" && r.nameHi ? r.nameHi : r.name}</span>
                    <span className="block text-xs text-ink-500">
                      {r.code} · {r.panLast4 ? `PAN XXXXXX${r.panLast4}` : t("statutory.tax.noPan")}
                      {r.published && (
                        <span className="ml-2 inline-flex items-center gap-1 font-medium text-brand-700">
                          <BadgeCheck className="size-3.5" aria-hidden="true" />
                          {t("statutory.form16.published")}
                        </span>
                      )}
                    </span>
                  </Td>
                  <Td label={t("statutory.tax.regime")}>{tDynamic(t, `statutory.tax.regimes.${r.regime}`)}</Td>
                  <Td label={t("statutory.form16.gross")} align="right">
                    {formatINR(r.gross)}
                  </Td>
                  <Td label={t("statutory.form16.taxable")} align="right">
                    {formatINR(r.taxable)}
                  </Td>
                  <Td label={t("statutory.form16.tax")} align="right" className="font-semibold text-ink-950">
                    {formatINR(r.tax)}
                  </Td>
                  <Td label={t("statutory.form16.tds")} align="right" className={r.tds < r.tax ? "font-medium text-amber-700" : ""}>
                    {formatINR(r.tds)}
                  </Td>
                  <Td label={t("statutory.my.partB")}>
                    {r.partB && r.formId ? (
                      <a href={`/api/v1/statutory/form16/${r.formId}/B`} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-700 hover:underline">
                        {t("statutory.download")}
                      </a>
                    ) : (
                      <span className="text-xs text-ink-400">{t("statutory.form16.notYet")}</span>
                    )}
                  </Td>
                  <Td label={t("statutory.my.partA")}>
                    {r.partA && r.formId ? (
                      <a href={`/api/v1/statutory/form16/${r.formId}/A`} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-700 hover:underline">
                        {t("statutory.download")}
                      </a>
                    ) : (
                      <span className="text-xs text-ink-400">{t("statutory.form16.notYet")}</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
