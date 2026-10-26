import type { Metadata } from "next";
import { CalendarDays, Clock4, Fingerprint, History, LogIn, Plane, TriangleAlert } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { requireActor } from "@/lib/auth/session";
import { formatDate, isMonth, monthOf, shiftMonth, todayIST, toISODate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { myAttendance } from "@/modules/attendance/service";
import { MonthNav } from "../../attendance/_components/month-nav";
import { REQUEST_TONE } from "../../attendance/_components/tones";
import { WithdrawButton } from "../../employees/_components/widgets";
import { MyCalendar } from "./my-calendar";

export const metadata: Metadata = { title: "My attendance" };

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default async function MyAttendancePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const actor = await requireActor();
  if (!actor.employeeId || actor.loginType !== "EMPLOYEE") return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const today = todayIST();
  const month = sp.month && isMonth(sp.month) && sp.month <= monthOf(today) ? sp.month : monthOf(today);
  const data = await myAttendance(actor, month);
  const tot = data.row.totals;
  const holidayNames = new Map(data.holidays.map((h) => [h.date, locale === "hi" ? h.nameHi : h.name]));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={t("attendance.my.title")} description={t("attendance.my.subtitle")} actions={<MonthNav month={month} locale={locale} maxMonth={monthOf(today)} hrefFor={(m) => `/my/attendance?month=${m}`} labels={{ prev: t("attendance.register.prev"), next: t("attendance.register.next") }} />} />
      {data.mode === "MANUAL" && <p className="rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-sky-600/15">{t("attendance.my.manualNote")}</p>}
      {data.lock && <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900 ring-1 ring-brand-600/10">{t("attendance.my.lockedNote", { name: data.lock.lockedByName })}</p>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label={t("attendance.status.PRESENT")} value={fmt(tot.present)} icon={<LogIn className="size-4.5" aria-hidden="true" />} />
        <StatTile label={t("attendance.status.LATE")} value={tot.late} tone="amber" icon={<Clock4 className="size-4.5" aria-hidden="true" />} />
        <StatTile label={`${t("attendance.status.ABSENT")} / ${t("attendance.status.MISSED_PUNCH")}`} value={tot.absent + tot.missedPunch} tone={tot.absent + tot.missedPunch ? "red" : "gray"} icon={<TriangleAlert className="size-4.5" aria-hidden="true" />} />
        <StatTile label={`${t("attendance.status.ON_DUTY")} / ${t("attendance.status.LEAVE")}`} value={fmt(tot.onDuty + tot.leave)} tone="blue" icon={<Plane className="size-4.5" aria-hidden="true" />} />
      </div>
      <Card>
        <CardHeader title={t("attendance.my.title")} description={t("attendance.my.tapDay")} icon={<Fingerprint className="size-4.5" aria-hidden="true" />} />
        <MyCalendar
          today={today}
          locked={!!data.lock}
          manual={data.mode === "MANUAL"}
          canRequestFrom={[`${shiftMonth(monthOf(today), -1)}-01`, data.joinedOn].sort().at(-1)!}
          days={data.row.days.map((d) => ({
            date: d.date,
            status: d.status,
            onRoll: d.onRoll,
            firstIn: d.firstIn ? d.firstIn.toISOString() : null,
            lastOut: d.lastOut ? d.lastOut.toISOString() : null,
            workedMinutes: d.workedMinutes,
            holidayName: holidayNames.get(d.date) ?? null,
          }))}
        />
      </Card>
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title={t("attendance.my.myRequests")} icon={<History className="size-4.5" aria-hidden="true" />} />
          {data.requests.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-600">{t("attendance.my.noRequests")}</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-ink-100">
              {data.requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900">
                      {formatDate(toISODate(r.date), locale)} · {tDynamic(t, `attendance.requests.type.${r.type}`)}
                    </p>
                    <p className="truncate text-xs text-ink-500">{r.reason}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={REQUEST_TONE[r.status]} dot>
                      {tDynamic(t, `attendance.requests.status.${r.status}`)}
                    </Badge>
                    {r.status === "PENDING" && r.taskId && <WithdrawButton taskId={r.taskId} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={t("attendance.my.holidaysThisMonth")} icon={<CalendarDays className="size-4.5" aria-hidden="true" />} />
          {data.holidays.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-600">{t("attendance.my.noHolidays")}</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-ink-100">
              {data.holidays.map((h) => (
                <li key={`${h.date}-${h.name}`} className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6">
                  <div>
                    <p className="text-sm font-medium text-ink-900">{locale === "hi" ? h.nameHi : h.name}</p>
                    <p className="text-xs text-ink-500">{formatDate(h.date, locale)}</p>
                  </div>
                  <Badge tone={h.kind === "GAZETTED" ? "gold" : "gray"}>{h.kind === "GAZETTED" ? t("attendance.holidays.gazetted") : t("attendance.my.restricted")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
