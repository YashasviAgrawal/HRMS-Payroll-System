import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Info } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink } from "@/components/ui/row-link";
import { Table, Td, Th, THead } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { listPensioners } from "@/modules/pension/pensioners";
import { LC_TONE, PensionTabs } from "../_components/pension-tabs";

export const metadata: Metadata = { title: "Life certificates" };

const FILTERS = ["ALL", "DUE_SOON", "OVERDUE", "HELD", "WAITING"] as const;

/** PN-06, report 24: every running pension's life certificate — due soon, overdue, held, and uploads to check. */
export default async function LifeCertificatesPage({ searchParams }: { searchParams: Promise<{ lc?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "pension", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const filter = (FILTERS as readonly string[]).includes(sp.lc ?? "") ? (sp.lc as (typeof FILTERS)[number]) : "ALL";
  const data = await listPensioners(actor, { status: "ACTIVE", lc: filter === "ALL" ? undefined : filter });
  const counts: Record<(typeof FILTERS)[number], number> = { ALL: data.counts.active, DUE_SOON: data.counts.dueSoon, OVERDUE: data.counts.overdue, HELD: data.counts.held, WAITING: data.counts.waiting };

  return (
    <div>
      <PageHeader title={t("pension.title")} description={t("pension.lc.subtitle")} />
      <PensionTabs active="certificates" t={t} />
      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-brand-100 bg-brand-50/60 px-4 py-3 text-sm text-brand-900">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>{t("pension.lc.rules")}</p>
      </div>
      <Card>
        <CardHeader
          title={t("pension.lc.register")}
          icon={<BadgeCheck className="size-4.5" aria-hidden="true" />}
          actions={
            <div className="flex flex-wrap gap-1 rounded-xl bg-ink-100 p-1" role="group">
              {FILTERS.map((f) => (
                <Link key={f} href={`/pension/life-certificates?lc=${f}`} aria-current={filter === f ? "page" : undefined} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", filter === f ? "bg-white text-brand-800 shadow-card" : "text-ink-600 hover:text-ink-900")}>
                  {tDynamic(t, `pension.lc.filter.${f}`)} <span className="tabular text-ink-400">{counts[f]}</span>
                </Link>
              ))}
            </div>
          }
        />
        {data.rows.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("pension.lc.noneHere")}</p>
          </CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("pension.pensioners.pensioner")}</Th>
                <Th>{t("pension.lc.statusCol")}</Th>
                <Th>{t("pension.lc.validTill")}</Th>
                <Th>{t("pension.lc.last")}</Th>
                <Th>{t("pension.fields.mobile")}</Th>
              </tr>
            </THead>
            <tbody>
              {data.rows.map((p) => (
                <RowLink key={p.id} href={`/pension/pensioners/${p.id}`}>
                  <Td>
                    <Link href={`/pension/pensioners/${p.id}`} className="font-medium text-ink-900 hover:text-brand-700">
                      {locale === "hi" && p.payeeHi ? p.payeeHi : p.payee}
                    </Link>
                    <span className="block text-xs text-ink-500">
                      {p.ppoNumber} · {t("pension.pensioners.age", { age: p.age })}
                    </span>
                  </Td>
                  <Td label={t("pension.lc.statusCol")}>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={LC_TONE[p.lc.state]} dot>
                        {tDynamic(t, `pension.lc.state.${p.lc.state}`)}
                      </Badge>
                      {p.lc.waiting > 0 && <Badge tone="blue">{t("pension.lc.waiting")}</Badge>}
                    </div>
                  </Td>
                  <Td label={t("pension.lc.validTill")}>
                    {formatDate(p.lc.validTill, locale)}
                    {p.lc.state === "OVERDUE" && <span className="block text-xs text-red-700">{t("pension.lc.holdFrom", { date: formatDate(p.lc.holdFrom, locale) })}</span>}
                  </Td>
                  <Td label={t("pension.lc.last")}>{p.lc.lastOn ? formatDate(p.lc.lastOn, locale) : "—"}</Td>
                  <Td label={t("pension.fields.mobile")}>{p.mobile ? <a href={`tel:${p.mobile}`} className="text-brand-700 hover:underline">{p.mobile}</a> : "—"}</Td>
                </RowLink>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
