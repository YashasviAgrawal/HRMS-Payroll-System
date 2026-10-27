import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink } from "@/components/ui/row-link";
import { Table, Td, Th, THead } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { currentFy, listDeclarations } from "@/modules/statutory/tax";
import { DECL_TONE, StatutoryTabs } from "../_components/statutory-tabs";
import { PeriodPicker } from "../_components/year-picker";

export const metadata: Metadata = { title: "Tax declarations" };

const FILTERS = ["ALL", "WAITING", "VERIFIED", "NONE"] as const;

/** ST-02, ST-03, S-51 (HR & Accounts): everyone's regime and declaration, and what waits for a check. */
export default async function DeclarationsPage({ searchParams }: { searchParams: Promise<{ fy?: string; status?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "statutory", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const status = (FILTERS as readonly string[]).includes(sp.status ?? "") ? sp.status! : "ALL";
  const thisFy = currentFy();
  const data = await listDeclarations(actor, { fy: sp.fy, status: status === "NONE" ? undefined : status });
  const rows = status === "NONE" ? data.rows.filter((r) => r.status === "NONE" || r.status === "DRAFT") : data.rows;
  const counts: Record<(typeof FILTERS)[number], number> = { ALL: data.counts.all, WAITING: data.counts.waiting, VERIFIED: data.counts.verified, NONE: data.counts.none };
  const prev = `${Number(thisFy.slice(0, 4)) - 1}-${thisFy.slice(2, 4)}`;

  return (
    <div>
      <PageHeader title={t("statutory.title")} description={t("statutory.tax.subtitle")} />
      <StatutoryTabs active="declarations" t={t} />
      <PeriodPicker options={[thisFy, prev]} active={data.fy} href={(fy) => `/statutory/declarations?fy=${fy}`} label={t("statutory.fy")} />
      <Card>
        <CardHeader
          title={t("statutory.tabs.declarations")}
          icon={<ScrollText className="size-4.5" aria-hidden="true" />}
          actions={
            <div className="flex flex-wrap gap-1 rounded-xl bg-ink-100 p-1" role="group">
              {FILTERS.map((f) => (
                <Link key={f} href={`/statutory/declarations?fy=${data.fy}&status=${f}`} aria-current={status === f ? "page" : undefined} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", status === f ? "bg-white text-brand-800 shadow-card" : "text-ink-600 hover:text-ink-900")}>
                  {tDynamic(t, `statutory.tax.filter.${f}`)} <span className="tabular text-ink-500">{counts[f]}</span>
                </Link>
              ))}
            </div>
          }
        />
        {rows.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("statutory.tax.none")}</p>
          </CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("statutory.employee")}</Th>
                <Th>{t("statutory.tax.regime")}</Th>
                <Th>{t("statutory.status")}</Th>
                <Th align="right">{t("statutory.tax.declared")}</Th>
                <Th align="right">{t("statutory.tax.proofs")}</Th>
                <Th align="right">{t("statutory.tax.yearTax")}</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <RowLink key={r.employeeId} href={`/statutory/declarations/${r.employeeId}?fy=${data.fy}`}>
                  <Td>
                    <Link href={`/statutory/declarations/${r.employeeId}?fy=${data.fy}`} className="font-medium text-ink-900 hover:text-brand-700">
                      {locale === "hi" && r.nameHi ? r.nameHi : r.name}
                    </Link>
                    <span className="block text-xs text-ink-500">
                      {r.code}
                      {!r.hasPan && <span className="ml-2 font-medium text-amber-700">{t("statutory.tax.noPan")}</span>}
                    </span>
                  </Td>
                  <Td label={t("statutory.tax.regime")}>{tDynamic(t, `statutory.tax.regimes.${r.regime}`)}</Td>
                  <Td label={t("statutory.status")}>
                    <Badge tone={r.taskId ? "amber" : DECL_TONE[r.status as keyof typeof DECL_TONE]} dot>
                      {tDynamic(t, `statutory.tax.status.${r.taskId ? "SUBMITTED" : r.status}`)}
                    </Badge>
                  </Td>
                  <Td label={t("statutory.tax.declared")} align="right">
                    {r.declared ? formatINR(r.declared) : "—"}
                  </Td>
                  <Td label={t("statutory.tax.proofs")} align="right">
                    {r.proofs || "—"}
                  </Td>
                  <Td label={t("statutory.tax.yearTax")} align="right" className="font-semibold text-ink-950">
                    {formatINR(r.annualTax)}
                    <span className="block text-xs font-normal text-ink-500">
                      {t("statutory.tax.tdsSoFar")} {formatINR(r.deducted)}
                    </span>
                  </Td>
                </RowLink>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
