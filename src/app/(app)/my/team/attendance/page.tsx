import type { Metadata } from "next";
import { Clock4, Lock, LogIn, Plane, UserX } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { requireActor } from "@/lib/auth/session";
import { formatDate, formatMonth, isMonth, istTime, monthOf, todayIST, toISODate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { canLockSection, locksDue, sectionRegister, todayBoard } from "@/modules/attendance/service";
import { toGrid } from "../../../attendance/_components/grid-data";
import { MonthNav } from "../../../attendance/_components/month-nav";
import { RegisterGrid } from "../../../attendance/_components/register-grid";
import { BADGE } from "../../../attendance/_components/tones";
import { TeamTabs } from "../team-tabs";

export const metadata: Metadata = { title: "Team attendance" };

/** AT-05, AT-07 for a reporting officer: today, the month register and the lock, for their own section. */
export default async function TeamAttendancePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const actor = await requireActor();
  if (!actor.permissions.includes("REPORTING_OFFICER") || !actor.sectionId) return <NoAccess />;
  const sectionId = actor.sectionId;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const today = todayIST();
  const month = sp.month && isMonth(sp.month) && sp.month <= monthOf(today) ? sp.month : monthOf(today);
  const [board, reg, due] = await Promise.all([todayBoard(actor), sectionRegister(actor, sectionId, month), locksDue(actor)]);
  const mine = board.sections.find((s) => s.section.id === sectionId);
  const sectionName = locale === "hi" ? reg.section.nameHi : reg.section.name;
  const lockOpen = due && due.open.some((s) => s.id === sectionId);

  return (
    <div className="space-y-6">
      <PageHeader title={t("attendance.team.title")} description={t("attendance.team.subtitle", { section: sectionName })} />
      <TeamTabs active="attendance" labels={{ people: t("attendance.team.tabPeople"), attendance: t("attendance.team.tabAttendance"), leave: t("leave.title") }} />

      {lockOpen && due && canLockSection(actor, sectionId) && (
        <Card className={due.overdue ? "border-red-200" : "border-amber-200"}>
          <CardBody className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className={due.overdue ? "font-semibold text-red-800" : "font-semibold text-ink-900"}>
                {due.overdue ? t("home.lockOverdueWork", { month: formatMonth(due.month, locale), date: formatDate(due.due, locale) }) : t("attendance.team.lockDue", { month: formatMonth(due.month, locale), date: formatDate(due.due, locale) })}
              </p>
              <p className="mt-1 text-sm text-ink-600">{t("attendance.team.lockDueHint")}</p>
            </div>
            <LinkButton href={`/attendance/lock?section=${sectionId}&month=${due.month}`} variant="primary" icon={<Lock className="size-4" aria-hidden="true" />}>
              {t("attendance.lock.review")}
            </LinkButton>
          </CardBody>
        </Card>
      )}

      {mine && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid grid-cols-2 gap-4">
            <StatTile label={t("attendance.today.present")} value={mine.counts.present} hint={t("home.presentOf", { count: mine.counts.staff })} icon={<LogIn className="size-4.5" aria-hidden="true" />} />
            <StatTile label={t("attendance.today.late")} value={mine.counts.late} tone="amber" icon={<Clock4 className="size-4.5" aria-hidden="true" />} />
            <StatTile label={t("attendance.today.notIn")} value={mine.counts.notIn + mine.counts.unmarked} tone="red" icon={<UserX className="size-4.5" aria-hidden="true" />} />
            <StatTile label={`${t("attendance.today.onDuty")} / ${t("attendance.today.onLeave")}`} value={mine.counts.onDuty + mine.counts.onLeave} tone="blue" icon={<Plane className="size-4.5" aria-hidden="true" />} />
          </div>
          <Card>
            <CardHeader title={`${t("attendance.tabs.today")} · ${formatDate(board.today, locale)}`} />
            <ul className="divide-y divide-ink-100">
              {mine.people.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-2.5 sm:px-6">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">{(locale === "hi" && p.nameHi) || p.name}</p>
                    <p className="text-xs text-ink-500">{p.code}</p>
                  </div>
                  {p.status ? (
                    <Badge tone={BADGE[p.status]} dot>
                      {tDynamic(t, `attendance.status.${p.status}`)}
                      {p.firstIn ? ` · ${istTime(p.firstIn)}` : ""}
                    </Badge>
                  ) : (
                    <Badge tone="red">{t("attendance.today.notIn")}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-ink-900">{t("attendance.tabs.register")}</h2>
        <MonthNav month={month} locale={locale} maxMonth={monthOf(today)} hrefFor={(m) => `/my/team/attendance?month=${m}`} labels={{ prev: t("attendance.register.prev"), next: t("attendance.register.next") }} />
      </div>
      {reg.lock && (
        <p className="flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900 ring-1 ring-brand-600/10">
          <Lock className="size-4" aria-hidden="true" /> {t("attendance.register.locked", { name: reg.lock.lockedByName, date: formatDate(toISODate(reg.lock.lockedAt), locale) })}
        </p>
      )}
      <Card className="overflow-hidden">
        <RegisterGrid rows={toGrid(reg.rows)} dates={reg.dates} holidays={reg.holidays} weeklyOff={reg.weeklyOff} sectionId={sectionId} month={month} today={reg.today} canEdit={false} />
      </Card>
      {reg.canLock && (
        <div className="flex justify-end">
          <LinkButton href={`/attendance/lock?section=${sectionId}&month=${month}`} variant="primary" icon={<Lock className="size-4" aria-hidden="true" />}>
            {t("attendance.register.lockThis")}
          </LinkButton>
        </div>
      )}
    </div>
  );
}
