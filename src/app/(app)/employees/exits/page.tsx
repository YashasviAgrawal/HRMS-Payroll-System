import type { Metadata } from "next";
import { DoorOpen } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink } from "@/components/ui/row-link";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, THead } from "@/components/ui/table";
import { requireActor } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { canSeeSeparations, listSeparations } from "@/modules/employees/separation";
import { SEPARATION_TONE, SETTLEMENT_TONE } from "./tones";

export const metadata: Metadata = { title: "Suspensions and leaving" };

/** Client add-on: suspensions and people leaving service; "open" ones still need an approval, a reinstatement or the settlement. */
export default async function ExitsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const actor = await requireActor();
  if (!canSeeSeparations(actor)) return <NoAccess />;
  const { t, locale } = await getT();
  const { show } = await searchParams;
  const all = show === "all";
  const rows = await listSeparations(actor, { show: all ? "all" : "open" });
  return (
    <div>
      <PageHeader breadcrumbs={[{ label: t("employees.title"), href: "/employees" }, { label: t("employees.exit.title") }]} title={t("employees.exit.title")} description={t("employees.exit.subtitle")} />
      <LinkTabs
        className="mb-4"
        active={all ? "all" : "open"}
        tabs={[
          { key: "open", label: t("employees.exit.tabs.open"), href: "/employees/exits" },
          { key: "all", label: t("employees.exit.tabs.all"), href: "/employees/exits?show=all" },
        ]}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<DoorOpen className="size-6" aria-hidden="true" />} title={t("employees.exit.none")} description={t("employees.exit.noneHelp")} />
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("employees.columns.employee")}</Th>
                <Th>{t("employees.exit.what")}</Th>
                <Th>{t("employees.exit.date")}</Th>
                <Th>{t("employees.exit.order")}</Th>
                <Th>{t("employees.columns.status")}</Th>
                <Th>{t("employees.exit.settlement")}</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <RowLink key={r.id} href={`/employees/exits/${r.id}`}>
                  <Td>
                    <p className="font-medium text-ink-900">{locale === "hi" && r.employee.nameHi ? r.employee.nameHi : r.employee.name}</p>
                    <p className="tabular text-xs text-ink-500">{r.employee.code}</p>
                  </Td>
                  <Td label={t("employees.exit.what")}>{tDynamic(t, `employees.exit.kind.${r.kind}`)}</Td>
                  <Td label={t("employees.exit.date")} className="whitespace-nowrap">
                    {formatDate(r.effectiveDate, locale)}
                    {r.endDate && <span className="block text-xs text-ink-500">{t("employees.exit.endedOn", { date: formatDate(r.endDate, locale) })}</span>}
                  </Td>
                  <Td label={t("employees.exit.order")} className="text-ink-600">
                    {r.orderNumber}
                    <span className="block text-xs text-ink-500">{formatDate(r.orderDate, locale)}</span>
                  </Td>
                  <Td label={t("employees.columns.status")}>
                    <Badge tone={SEPARATION_TONE[r.status as keyof typeof SEPARATION_TONE]} dot>
                      {tDynamic(t, `employees.exit.status.${r.kind === "SUSPENSION" && r.status === "APPROVED" ? "SUSPENDED" : r.status}`)}
                    </Badge>
                  </Td>
                  <Td label={t("employees.exit.settlement")}>
                    {r.kind === "SUSPENSION" || r.status !== "APPROVED" ? (
                      <span className="text-ink-400">—</span>
                    ) : (
                      <Badge tone={SETTLEMENT_TONE[r.settlementStatus as keyof typeof SETTLEMENT_TONE]}>{tDynamic(t, `employees.exit.settlementStatus.${r.settlementStatus}`)}</Badge>
                    )}
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
