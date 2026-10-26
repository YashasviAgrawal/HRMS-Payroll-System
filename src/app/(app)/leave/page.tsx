import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarHeart, CalendarPlus, History, ScrollText } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink } from "@/components/ui/row-link";
import { Table, Td, Th, THead } from "@/components/ui/table";
import { scopeFor } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDate, toISODate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { myLeave } from "@/modules/leave/service";
import { BalanceCards } from "./_components/balance-cards";
import { LEAVE_TONE } from "./_components/tones";

export const metadata: Metadata = { title: "Leave" };

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** S-31 for the Employee login: balances, applications, restricted holidays. HR & Accounts work from /leave/manage. */
export default async function LeavePage() {
  const actor = await requireActor();
  if (actor.loginType !== "EMPLOYEE") {
    if (scopeFor(actor, "leave", "view") === "all") redirect("/leave/manage");
    return <NoAccess />;
  }
  if (!actor.employeeId) return <NoAccess />;
  const { t, locale } = await getT();
  const data = await myLeave(actor);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={t("leave.title")}
        description={t("leave.subtitle")}
        actions={
          <>
            <LinkButton href="/leave/ledger/me" icon={<ScrollText className="size-4" aria-hidden="true" />}>
              {t("leave.account")}
            </LinkButton>
            <LinkButton href="/leave/apply" variant="primary" icon={<CalendarPlus className="size-4" aria-hidden="true" />}>
              {t("leave.apply")}
            </LinkButton>
          </>
        }
      />
      <section aria-label={t("leave.balances")}>
        <BalanceCards balances={data.balances} t={t} locale={locale} />
      </section>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t("leave.myApplications")} icon={<History className="size-4.5" aria-hidden="true" />} />
          {data.applications.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-600">{t("leave.noApplications")}</p>
            </CardBody>
          ) : (
            <Table stack>
              <THead>
                <tr>
                  <Th>{t("leave.type")}</Th>
                  <Th>{t("leave.application.dates")}</Th>
                  <Th align="right">{t("leave.application.days")}</Th>
                  <Th>{t("common.status")}</Th>
                </tr>
              </THead>
              <tbody>
                {data.applications.map((a) => (
                  <RowLink key={a.id} href={`/leave/applications/${a.id}`}>
                    <Td>
                      <p className="font-medium text-ink-900">{a.leaveCode}</p>
                      <p className="max-w-xs truncate text-xs text-ink-500">{a.reason}</p>
                    </Td>
                    <Td label={t("leave.application.dates")} className="whitespace-nowrap">
                      {formatDate(toISODate(a.fromDate), locale)}
                      {a.toDate.getTime() !== a.fromDate.getTime() && ` – ${formatDate(toISODate(a.toDate), locale)}`}
                    </Td>
                    <Td align="right" label={t("leave.application.days")}>{fmt(Number(a.days))}</Td>
                    <Td label={t("common.status")}>
                      <Badge tone={LEAVE_TONE[a.status]} dot>
                        {tDynamic(t, `leave.status.${a.status}`)}
                      </Badge>
                    </Td>
                  </RowLink>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title={t("leave.rhList")} icon={<CalendarHeart className="size-4.5" aria-hidden="true" />} />
          {data.restrictedHolidays.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-600">{t("leave.noRh")}</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-ink-100">
              {data.restrictedHolidays.slice(0, 8).map((h) => (
                <li key={h.date} className="flex items-center justify-between gap-3 px-5 py-2.5 sm:px-6">
                  <div>
                    <p className="text-sm font-medium text-ink-900">{locale === "hi" ? h.nameHi : h.name}</p>
                    <p className="text-xs text-ink-500">{formatDate(h.date, locale)}</p>
                  </div>
                  <LinkButton href={`/leave/apply?type=RH&date=${h.date}`} size="sm" variant="ghost">
                    {t("leave.apply")}
                  </LinkButton>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
