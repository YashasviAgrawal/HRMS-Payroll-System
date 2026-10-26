import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, History, Scale, Users, Wallet } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink } from "@/components/ui/row-link";
import { StatTile } from "@/components/ui/stat-tile";
import { Stepper } from "@/components/ui/stepper";
import { Table, Td, Th, THead } from "@/components/ui/table";
import { can, canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime, formatMonth, todayIST } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { STAGE_KEYS, STATUS_TONE, stageIndex } from "@/modules/payroll/present";
import { payrollOverview } from "@/modules/payroll/run";
import { MonthNav } from "../attendance/_components/month-nav";
import { PayrollTabs } from "./_components/payroll-tabs";
import { RunButton } from "./run-button";

export const metadata: Metadata = { title: "Payroll" };

/** S-40 home: this month's payroll for each pay group, and the earlier months. */
export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "payroll", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const data = await payrollOverview(actor, sp.month);
  const thisMonth = todayIST().slice(0, 7);
  const monthNet = data.groups.reduce((s, g) => s + (g.run?.net ?? 0), 0);
  const monthPeople = data.groups.reduce((s, g) => s + (g.run?.employees ?? 0), 0);
  const steps = STAGE_KEYS.map((k) => t(`payroll.stages.${k}`));

  return (
    <div>
      <PageHeader
        title={t("payroll.title")}
        description={t("payroll.subtitle")}
        actions={
          (can(actor, "rates_rules", "view") || can(actor, "rates_rules", "create")) && (
            <LinkButton href="/admin/rates" variant="secondary" icon={<Scale className="size-4" />}>
              {t("payroll.ratesLink")}
            </LinkButton>
          )
        }
      />
      <PayrollTabs active="runs" labels={{ runs: t("payroll.tabs.runs"), items: t("payroll.tabs.items") }} showItems={canAll(actor, "payroll", "create") || actor.permissions.includes("CHECKER")} />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={data.month} hrefFor={(m) => `/payroll?month=${m}`} maxMonth={thisMonth} locale={locale} labels={{ prev: t("payroll.prevMonth"), next: t("payroll.nextMonth") }} />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <StatTile label={t("payroll.monthNet")} value={formatINR(monthNet)} icon={<Wallet className="size-5" aria-hidden="true" />} hint={formatMonth(data.month, locale)} />
        <StatTile label={t("payroll.peoplePaid")} value={monthPeople} icon={<Users className="size-5" aria-hidden="true" />} tone="blue" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {data.groups.map(({ group, run }) => {
          const stage = stageIndex(run?.status ?? null);
          return (
            <Card key={group} className="flex flex-col" data-testid={`group-${group}`}>
              <CardHeader
                title={t(`payroll.groups.${group}`)}
                description={t(`payroll.groupHelp.${group}`)}
                actions={run ? <Badge tone={STATUS_TONE[run.status]}>{tDynamic(t, `payroll.status.${run.status}`)}</Badge> : <Badge>{t("payroll.notRun")}</Badge>}
              />
              <CardBody className="flex flex-1 flex-col gap-4">
                <Stepper steps={steps} current={stage} label={t(`payroll.groups.${group}`)} compact />
                {run ? (
                  <>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-ink-500">{t("payroll.people")}</dt>
                        <dd className="tabular text-lg font-semibold text-ink-950">{run.employees}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-500">{t("payroll.net")}</dt>
                        <dd className="tabular text-lg font-semibold text-ink-950">{formatINR(run.net)}</dd>
                      </div>
                    </dl>
                    {run.status === "DRAFT" && (
                      <p className={cn("text-sm font-medium", run.openExceptions ? "text-amber-700" : "text-brand-700")}>{run.openExceptions ? t("payroll.toFix", { count: run.openExceptions }) : t("payroll.allClear")}</p>
                    )}
                    <p className="text-xs text-ink-500">{t("payroll.ranBy", { name: run.runByName, when: formatDateTime(run.runAt, locale) })}</p>
                    <div className="mt-auto">
                      <LinkButton href={`/payroll/${run.id}`} variant="secondary" className="w-full" icon={<ArrowRight className="size-4" />}>
                        {t("payroll.open")}
                      </LinkButton>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-ink-600">{t("payroll.notRunHelp")}</p>
                    {data.canRun && (
                      <div className="mt-auto">
                        <RunButton payGroup={group} month={data.month} />
                      </div>
                    )}
                  </>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6">
        <CardHeader title={t("payroll.history")} icon={<History className="size-4.5" aria-hidden="true" />} />
        {data.history.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("payroll.noHistory")}</p>
          </CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("payroll.month")}</Th>
                <Th>{t("payroll.payGroup")}</Th>
                <Th align="right">{t("payroll.people")}</Th>
                <Th align="right">{t("payroll.gross")}</Th>
                <Th align="right">{t("payroll.net")}</Th>
                <Th>{t("payroll.columns.status")}</Th>
              </tr>
            </THead>
            <tbody>
              {data.history.map((r) => (
                <RowLink key={r.id} href={`/payroll/${r.id}`}>
                  <Td className="font-medium text-ink-900">
                    <Link href={`/payroll/${r.id}`} className="hover:text-brand-700">
                      {formatMonth(r.month, locale)}
                    </Link>
                  </Td>
                  <Td label={t("payroll.payGroup")}>{tDynamic(t, `payroll.groups.${r.payGroup}`)}</Td>
                  <Td label={t("payroll.people")} align="right">
                    {r.employees}
                  </Td>
                  <Td label={t("payroll.gross")} align="right">
                    {formatINR(r.gross)}
                  </Td>
                  <Td label={t("payroll.net")} align="right" className="font-semibold text-ink-900">
                    {formatINR(r.net)}
                  </Td>
                  <Td label={t("payroll.columns.status")}>
                    <Badge tone={STATUS_TONE[r.status]}>{tDynamic(t, `payroll.status.${r.status}`)}</Badge>
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
