import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, CalendarClock, HandCoins, History, Users, Wallet } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink } from "@/components/ui/row-link";
import { StatTile } from "@/components/ui/stat-tile";
import { Stepper } from "@/components/ui/stepper";
import { Table, Td, Th, THead } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatMonth, todayIST } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { STAGE_KEYS, STATUS_TONE, stageIndex } from "@/modules/payroll/present";
import { pensionOverview } from "@/modules/pension/overview";
import { MonthNav } from "../attendance/_components/month-nav";
import { RunButton } from "../payroll/run-button";
import { PensionTabs } from "./_components/pension-tabs";

export const metadata: Metadata = { title: "Pension" };

/** S-61 home: the month's pension bill (the same five stages as salaries), and what needs doing. */
export default async function PensionPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "pension", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const data = await pensionOverview(actor, sp.month);
  const thisMonth = todayIST().slice(0, 7);
  const steps = STAGE_KEYS.map((k) => t(`payroll.stages.${k}`));
  const r = data.regular;
  const s = data.stats;
  const lcTone = s.held ? "red" : s.overdue ? "red" : s.dueSoon ? "amber" : "green";

  return (
    <div>
      <PageHeader
        title={t("pension.title")}
        description={t("pension.subtitle")}
        actions={
          data.can.run && (
            <LinkButton href="/pension/arrears" variant="secondary" icon={<HandCoins className="size-4" />}>
              {t("pension.arrears.link")}
            </LinkButton>
          )
        }
      />
      <PensionTabs active="bills" t={t} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t("pension.stats.pensioners")} value={s.pensioners} href="/pension/pensioners" icon={<Users className="size-5" aria-hidden="true" />} tone="blue" />
        <StatTile label={t("pension.stats.monthly")} value={s.monthlyNet === null ? "—" : formatINR(s.monthlyNet)} icon={<Wallet className="size-5" aria-hidden="true" />} hint={s.lastPaidMonth ? formatMonth(s.lastPaidMonth, locale) : undefined} />
        <StatTile
          label={t("pension.stats.certificates")}
          value={`${s.dueSoon} · ${s.overdue} · ${s.held}`}
          href="/pension/life-certificates"
          icon={<BadgeCheck className="size-5" aria-hidden="true" />}
          tone={lcTone}
          hint={t("pension.stats.certificatesHint", { waiting: s.waiting })}
        />
        <StatTile label={t("pension.stats.retiring")} value={s.retiring} href="/pension/cases" icon={<CalendarClock className="size-5" aria-hidden="true" />} tone={s.retiringNoCase ? "amber" : "gray"} hint={t("pension.stats.retiringHint", { count: s.retiringNoCase, open: s.openCases })} />
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={data.month} hrefFor={(m) => `/pension?month=${m}`} maxMonth={thisMonth} locale={locale} labels={{ prev: t("payroll.prevMonth"), next: t("payroll.nextMonth") }} />
      </div>

      <Card className="mb-6" data-testid="pension-bill">
        <CardHeader
          title={t("pension.bills.regular", { month: formatMonth(data.month, locale) })}
          description={t("pension.bills.regularHelp")}
          actions={r ? <Badge tone={STATUS_TONE[r.status]}>{tDynamic(t, `payroll.status.${r.status}`)}</Badge> : <Badge>{t("payroll.notRun")}</Badge>}
        />
        <CardBody className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-4">
            <Stepper steps={steps} current={stageIndex(r?.status ?? null)} label={t("pension.title")} compact />
            {r ? (
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-ink-500">{t("pension.bills.paid")}</dt>
                  <dd className="tabular text-lg font-semibold text-ink-950">{r.employees}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">{t("pension.bills.held")}</dt>
                  <dd className={cn("tabular text-lg font-semibold", r.withheld ? "text-amber-700" : "text-ink-950")}>{r.withheld}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">{t("payroll.gross")}</dt>
                  <dd className="tabular text-lg font-semibold text-ink-950">{formatINR(r.gross)}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">{t("payroll.net")}</dt>
                  <dd className="tabular text-lg font-semibold text-ink-950">{formatINR(r.net)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-ink-600">{t("pension.bills.notRunHelp")}</p>
            )}
            {r?.status === "DRAFT" && <p className={cn("text-sm font-medium", r.openExceptions ? "text-amber-700" : "text-brand-700")}>{r.openExceptions ? t("payroll.toFix", { count: r.openExceptions }) : t("payroll.allClear")}</p>}
          </div>
          <div>
            {r ? (
              <LinkButton href={`/pension/bills/${r.id}`} variant={r.status === "DRAFT" ? "primary" : "secondary"} icon={<ArrowRight className="size-4" />}>
                {t("payroll.open")}
              </LinkButton>
            ) : (
              data.can.run && <RunButton payGroup="PENSION" month={data.month} />
            )}
          </div>
        </CardBody>
      </Card>

      {data.supplementary.length > 0 && (
        <Card className="mb-6">
          <CardHeader title={t("pension.bills.supplementary")} description={t("pension.bills.supplementaryHelp")} />
          <ul className="divide-y divide-ink-100">
            {data.supplementary.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
                <Link href={`/pension/bills/${b.id}`} className="min-w-0 font-medium text-ink-900 hover:text-brand-700">
                  {locale === "hi" ? b.titleHi : b.title}
                </Link>
                <span className="flex items-center gap-3 text-sm">
                  <span className="tabular font-semibold">{formatINR(b.net)}</span>
                  <Badge tone={STATUS_TONE[b.status]}>{tDynamic(t, `payroll.status.${b.status}`)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title={t("pension.bills.history")} icon={<History className="size-4.5" aria-hidden="true" />} />
        {data.history.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("pension.bills.noHistory")}</p>
          </CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("payroll.month")}</Th>
                <Th>{t("pension.bills.bill")}</Th>
                <Th align="right">{t("pension.bills.paid")}</Th>
                <Th align="right">{t("pension.bills.net")}</Th>
                <Th>{t("payroll.columns.status")}</Th>
              </tr>
            </THead>
            <tbody>
              {data.history.map((b) => (
                <RowLink key={b.id} href={`/pension/bills/${b.id}`}>
                  <Td className="font-medium text-ink-900">
                    <Link href={`/pension/bills/${b.id}`} className="hover:text-brand-700">
                      {formatMonth(b.month, locale)}
                    </Link>
                  </Td>
                  <Td label={t("pension.bills.bill")}>{b.kind === "SUPPLEMENTARY" ? <span className="text-violet-700">{locale === "hi" ? b.titleHi : b.title}</span> : t("pension.bills.monthly")}</Td>
                  <Td label={t("pension.bills.paid")} align="right">
                    {b.employees}
                  </Td>
                  <Td label={t("pension.bills.net")} align="right" className="font-semibold text-ink-900">
                    {formatINR(b.net)}
                  </Td>
                  <Td label={t("payroll.columns.status")}>
                    <Badge tone={STATUS_TONE[b.status]}>{tDynamic(t, `payroll.status.${b.status}`)}</Badge>
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
