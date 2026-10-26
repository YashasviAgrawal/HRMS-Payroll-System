import type { Metadata } from "next";
import { CalendarDays, CalendarRange } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateTime, todayIST } from "@/lib/dates";
import { getT } from "@/lib/i18n/server";
import { listHolidays } from "@/modules/attendance/holidays";
import { attendanceRules, canEnterMuster, sectionScope } from "@/modules/attendance/service";
import { YearNav } from "./year-nav";
import { HolidayEditor } from "./holiday-editor";
import { SectionRules } from "./section-rules";

export const metadata: Metadata = { title: "Holiday calendar" };

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const actor = await requireActor();
  if (!can(actor, "attendance", "view")) return <NoAccess />;
  const { t } = await getT();
  const sp = await searchParams;
  const thisYear = Number(todayIST().slice(0, 4));
  const year = Number(sp.year) >= 2000 && Number(sp.year) <= thisYear + 2 ? Number(sp.year) : thisYear;
  const [data, last, rules] = await Promise.all([listHolidays(actor, year), listHolidays(actor, year - 1), attendanceRules(actor.boardId)]);
  const showSections = sectionScope(actor) === "all";
  const sections = showSections ? await db.section.findMany({ where: { boardId: actor.boardId, isActive: true }, orderBy: { name: "asc" } }) : [];
  const gazetted = data.holidays.filter((h) => h.kind === "GAZETTED").length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        breadcrumbs={showSections ? [{ label: t("attendance.title"), href: "/attendance" }, { label: t("attendance.holidays.title") }] : undefined}
        title={t("attendance.holidays.title")}
        description={t("attendance.holidays.subtitle")}
        actions={<YearNav year={year} max={thisYear + 2} />}
      />
      {data.pending && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/15">
          {t("attendance.holidays.pending", { name: data.pending.makerName, date: formatDateTime(data.pending.createdAt) })}
        </p>
      )}
      <Card>
        <CardHeader
          title={`${t("attendance.holidays.title")} ${year}`}
          icon={<CalendarDays className="size-4.5" aria-hidden="true" />}
          actions={<Badge tone="gold">{t("attendance.holidays.count", { gazetted, restricted: data.holidays.length - gazetted })}</Badge>}
        />
        <HolidayEditor key={`${year}-${data.holidays.length}-${data.pending?.id ?? ""}`} year={year} holidays={data.holidays} lastYear={last.holidays} canEdit={canEnterMuster(actor)} pending={!!data.pending} />
      </Card>
      {showSections && (
        <Card>
          <CardHeader title={t("attendance.holidays.workingWeek")} description={t("attendance.holidays.workingWeekHint")} icon={<CalendarRange className="size-4.5" aria-hidden="true" />} />
          <SectionRules sections={sections.map((s) => ({ id: s.id, name: s.name, nameHi: s.nameHi, attendanceMode: s.attendanceMode, weeklyOff: s.weeklyOff }))} boardWeeklyOff={rules.weeklyOff} canEdit={canEnterMuster(actor)} />
        </Card>
      )}
    </div>
  );
}
