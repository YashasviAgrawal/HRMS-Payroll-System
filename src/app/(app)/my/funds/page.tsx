import type { Metadata } from "next";
import { PiggyBank } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { requireActor } from "@/lib/auth/session";
import { formatMonth } from "@/lib/dates";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { myFunds } from "@/modules/statutory/my-funds";
import { GpfAccountView } from "../../statutory/_components/gpf-account-view";
import { MyMoneyTabs } from "../_components/my-money-tabs";

export const metadata: Metadata = { title: "My GPF and NPS" };

/** S-50 (employee): my GPF account with its statement, or my NPS contributions from the pay bills. */
export default async function MyFundsPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const actor = await requireActor();
  if (!actor.employeeId) return <NoAccess />;
  const { t, locale } = await getT();
  const { gpf, nps } = await myFunds(actor, (await searchParams).fy);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={gpf ? t("statutory.gpf.own") : t("statutory.nps.own")} description={nps ? t("statutory.nps.ownHelp") : undefined} />
      <MyMoneyTabs active="funds" t={t} />
      {gpf && <GpfAccountView a={gpf} t={t} locale={locale} href={(fy) => `/my/funds?fy=${fy}`} />}
      {nps && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label={t("statutory.nps.yearOwn")} value={formatINR(nps.yearOwn)} hint={`${t("statutory.fy")} ${nps.fy}`} />
            <StatTile label={t("statutory.nps.yearBoard")} value={formatINR(nps.yearBoard)} tone="blue" />
            <StatTile label={t("statutory.nps.total")} value={formatINR(nps.totalOwn + nps.totalBoard)} hint={nps.pran ? `PRAN ${nps.pran}` : undefined} tone="gray" />
          </div>
          <Card>
            <CardHeader title={t("statutory.nps.title")} icon={<PiggyBank className="size-4.5" aria-hidden="true" />} />
            {nps.months.length === 0 ? (
              <CardBody>
                <p className="text-sm text-ink-600">{t("statutory.nps.none")}</p>
              </CardBody>
            ) : (
              <Table stack>
                <THead>
                  <tr>
                    <Th>{t("statutory.month")}</Th>
                    <Th align="right">{t("statutory.files.sums.own")}</Th>
                    <Th align="right">{t("statutory.files.sums.board")}</Th>
                  </tr>
                </THead>
                <tbody>
                  {nps.months.map((m) => (
                    <Tr key={m.month}>
                      <Td>{formatMonth(m.month, locale)}</Td>
                      <Td label={t("statutory.files.sums.own")} align="right">
                        {formatINR(m.own)}
                      </Td>
                      <Td label={t("statutory.files.sums.board")} align="right">
                        {formatINR(m.board)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
      {!gpf && !nps && (
        <Card>
          <EmptyState icon={<PiggyBank className="size-6" aria-hidden="true" />} title={t("statutory.nps.noAccount")} />
        </Card>
      )}
    </div>
  );
}
