import type { Metadata } from "next";
import { CalendarRange, Wallet } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink } from "@/components/ui/row-link";
import { Table, Td, Th, THead } from "@/components/ui/table";
import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDate, formatMonth, isMonth, monthOf, todayIST, toISODate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { fullName } from "@/modules/employees/present";
import { teamLeave } from "@/modules/leave/service";
import { MonthNav } from "../../../attendance/_components/month-nav";
import { LEAVE_TONE } from "../../../leave/_components/tones";
import { TeamTabs } from "../team-tabs";

export const metadata: Metadata = { title: "Team leave" };

const fmt = (n: number | null) => (n === null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));

export default async function TeamLeavePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const actor = await requireActor();
  if (!actor.permissions.includes("REPORTING_OFFICER") || !actor.sectionId) return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const month = sp.month && isMonth(sp.month) ? sp.month : monthOf(todayIST());
  const [data, section] = await Promise.all([teamLeave(actor, month), db.section.findUniqueOrThrow({ where: { id: actor.sectionId } })]);
  const byId = new Map(data.staff.map((s) => [s.id, s]));
  const codes = ["CL", "EL", "HPL"];

  return (
    <div className="space-y-6">
      <PageHeader title={t("leave.team.title")} description={t("leave.team.subtitle", { month: formatMonth(month, locale), section: locale === "hi" ? section.nameHi : section.name })} actions={<MonthNav month={month} locale={locale} hrefFor={(m) => `/my/team/leave?month=${m}`} labels={{ prev: t("attendance.register.prev"), next: t("attendance.register.next") }} />} />
      <TeamTabs active="leave" labels={{ people: t("attendance.team.tabPeople"), attendance: t("attendance.team.tabAttendance"), leave: t("leave.title") }} />
      <Card>
        <CardHeader title={t("leave.team.onLeave")} icon={<CalendarRange className="size-4.5" aria-hidden="true" />} />
        {data.applications.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("leave.team.none")}</p>
          </CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("employees.columns.employee")}</Th>
                <Th>{t("leave.type")}</Th>
                <Th>{t("leave.application.dates")}</Th>
                <Th align="right">{t("leave.application.days")}</Th>
                <Th>{t("common.status")}</Th>
              </tr>
            </THead>
            <tbody>
              {data.applications.map((a) => {
                const e = byId.get(a.employeeId)!;
                return (
                  <RowLink key={a.id} href={`/leave/applications/${a.id}`}>
                    <Td>
                      <p className="font-medium text-ink-900">{(locale === "hi" && e.nameHi) || fullName(e)}</p>
                      <p className="text-xs text-ink-500">{e.employeeCode}</p>
                    </Td>
                    <Td label={t("leave.type")}>{a.leaveCode}</Td>
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
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={t("leave.team.balances")} icon={<Wallet className="size-4.5" aria-hidden="true" />} />
        <Table stack>
          <THead>
            <tr>
              <Th>{t("employees.columns.employee")}</Th>
              {codes.map((c) => (
                <Th key={c} align="right">
                  {c}
                </Th>
              ))}
            </tr>
          </THead>
          <tbody>
            {data.balances.map(({ employee: e, balances }) => (
              <RowLink key={e.id} href={`/leave/ledger/${e.id}`}>
                <Td>
                  <p className="font-medium text-ink-900">{(locale === "hi" && e.nameHi) || fullName(e)}</p>
                  <p className="text-xs text-ink-500">{e.employeeCode}</p>
                </Td>
                {codes.map((c) => (
                  <Td key={c} align="right" label={c}>
                    {fmt(balances.find((b) => b.code === c)?.available ?? null)}
                  </Td>
                ))}
              </RowLink>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
