import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarDays, CalendarOff, Clock4, Fingerprint, Lock, LogIn, Plane, Radio, UserX } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink } from "@/components/ui/row-link";
import { StatTile } from "@/components/ui/stat-tile";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { can, scopeFor } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMonth, isMonth, monthOf, todayIST, toISODate } from "@/lib/dates";
import { env } from "@/lib/env";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { recentImports } from "@/modules/attendance/imports";
import { attendanceRules, canEnterMuster, lockDue, lockOverview, openRequests, sectionRegister, sectionScope, todayBoard, visibleSections } from "@/modules/attendance/service";
import { getSetting } from "@/modules/settings/service";
import { fullName } from "@/modules/employees/present";
import { AreaSwitch } from "./_components/area-switch";
import { toGrid } from "./_components/grid-data";
import { ImportPanel } from "./_components/import-panel";
import { MonthNav } from "./_components/month-nav";
import { RegisterGrid } from "./_components/register-grid";
import { ReopenButton } from "./_components/reopen-button";
import { SectionPicker } from "./_components/section-picker";
import { CELL, REQUEST_TONE } from "./_components/tones";
import { STATUS_CODE } from "@/modules/attendance/rules";

export const metadata: Metadata = { title: "Attendance" };

const TABS = ["today", "register", "lock", "requests", "import"] as const;
type Tab = (typeof TABS)[number];

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ tab?: string; section?: string; month?: string }> }) {
  const actor = await requireActor();
  const scope = sectionScope(actor);
  if (!scope) return <NoAccess />;
  // Reporting officers work from My team; this screen is the Board-wide one.
  if (scope !== "all") redirect("/my/team/attendance");
  const { t, locale } = await getT();
  const sp = await searchParams;
  const canMuster = canEnterMuster(actor);
  const tabs = TABS.filter((k) => k !== "import" || canMuster);
  const tab: Tab = (tabs as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "today";
  const today = todayIST();

  const content = tab === "register" ? await registerTab() : tab === "lock" ? await lockTab() : tab === "requests" ? await requestsTab() : tab === "import" ? await importTab() : await todayTab();

  return (
    <div>
      <PageHeader
        title={t("attendance.title")}
        description={t("attendance.subtitle")}
        actions={
          <LinkButton href="/attendance/holidays" icon={<CalendarDays className="size-4" aria-hidden="true" />}>
            {t("attendance.holidaysLink")}
          </LinkButton>
        }
      />
      {can(actor, "leave", "view") && <AreaSwitch active="attendance" labels={{ attendance: t("attendance.title"), leave: t("leave.title") }} />}
      <LinkTabs className="mb-5" active={tab} tabs={tabs.map((k) => ({ key: k, label: t(`attendance.tabs.${k}`), href: `/attendance?tab=${k}` }))} />
      {content}
    </div>
  );

  async function todayTab() {
    const board = await todayBoard(actor);
    const notIn = board.sections.flatMap((s) => s.people.filter((p) => p.status === null && s.section.attendanceMode === "DEVICE").map((p) => ({ ...p, section: locale === "hi" ? s.section.nameHi : s.section.name })));
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-ink-700">{formatDate(board.today, locale)}</p>
          {board.holiday && <Badge tone="gold">{t("attendance.today.holidayToday", { name: locale === "hi" ? board.holiday.nameHi : board.holiday.name })}</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatTile label={t("attendance.today.present")} value={board.total.present} hint={t("home.presentOf", { count: board.total.staff })} icon={<LogIn className="size-4.5" aria-hidden="true" />} />
          <StatTile label={t("attendance.today.late")} value={board.total.late} tone="amber" icon={<Clock4 className="size-4.5" aria-hidden="true" />} />
          <StatTile label={t("attendance.today.notIn")} value={board.total.notIn + board.total.unmarked} tone="red" icon={<UserX className="size-4.5" aria-hidden="true" />} />
          <StatTile label={t("attendance.today.onLeave")} value={board.total.onLeave} tone="blue" icon={<Plane className="size-4.5" aria-hidden="true" />} />
          <StatTile label={t("attendance.today.off")} value={board.total.off} tone="gray" icon={<CalendarOff className="size-4.5" aria-hidden="true" />} />
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader title={t("attendance.today.bySection")} icon={<Fingerprint className="size-4.5" aria-hidden="true" />} />
            <Table stack>
              <THead>
                <tr>
                  <Th>{t("attendance.register.section")}</Th>
                  <Th align="right">{t("attendance.today.staff")}</Th>
                  <Th align="right">{t("attendance.today.present")}</Th>
                  <Th align="right">{t("attendance.today.late")}</Th>
                  <Th align="right">{t("attendance.today.notIn")}</Th>
                  <Th align="right">{t("attendance.today.onDuty")}</Th>
                  <Th align="right">{t("attendance.today.off")}</Th>
                </tr>
              </THead>
              <tbody>
                {board.sections.map(({ section, counts }) => (
                  <RowLink key={section.id} href={`/attendance?tab=register&section=${section.id}`}>
                    <Td>
                      <p className="font-medium text-ink-900">{locale === "hi" ? section.nameHi : section.name}</p>
                      <p className="text-xs text-ink-500">{tDynamic(t, `attendance.mode.${section.attendanceMode}`)}</p>
                    </Td>
                    <Td align="right" label={t("attendance.today.staff")}>{counts.staff}</Td>
                    <Td align="right" label={t("attendance.today.present")} className="font-semibold text-brand-800">{counts.present}</Td>
                    <Td align="right" label={t("attendance.today.late")} className={cn(counts.late > 0 && "text-amber-700")}>{counts.late}</Td>
                    <Td align="right" label={section.attendanceMode === "MANUAL" ? t("attendance.today.unmarked") : t("attendance.today.notIn")} className={cn(counts.notIn + counts.unmarked > 0 && "text-red-700")}>
                      {counts.notIn + counts.unmarked}
                    </Td>
                    <Td align="right" label={t("attendance.today.onDuty")}>{counts.onDuty + counts.onLeave}</Td>
                    <Td align="right" label={t("attendance.today.off")}>{counts.off}</Td>
                  </RowLink>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title={t("attendance.today.notInList")} description={t("attendance.today.notInHint", { time: board.officeStart })} icon={<UserX className="size-4.5" aria-hidden="true" />} />
            {notIn.length === 0 ? (
              <CardBody>
                <p className="text-sm text-ink-600">{board.holiday ? t("attendance.today.holidayToday", { name: board.holiday.name }) : t("attendance.today.allIn")}</p>
              </CardBody>
            ) : (
              <ul className="max-h-[28rem] divide-y divide-ink-100 overflow-y-auto">
                {notIn.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-2.5 sm:px-6">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{(locale === "hi" && p.nameHi) || p.name}</p>
                      <p className="truncate text-xs text-ink-500">
                        {p.code} · {p.section}
                      </p>
                    </div>
                    <Badge tone="red">{t("attendance.today.notIn")}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    );
  }

  async function registerTab() {
    const sections = await visibleSections(actor);
    if (!sections.length) return <EmptyState icon={<CalendarDays className="size-5" />} title={t("attendance.register.noStaff")} />;
    const sectionId = sections.find((s) => s.id === sp.section)?.id ?? sections[0].id;
    const month = sp.month && isMonth(sp.month) && sp.month <= monthOf(today) ? sp.month : monthOf(today);
    const reg = await sectionRegister(actor, sectionId, month);
    const base = `/attendance?tab=register&section=${sectionId}`;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionPicker label={t("attendance.register.section")} value={sectionId} hrefBase={`/attendance?tab=register&month=${month}`} sections={sections.map((s) => ({ id: s.id, name: locale === "hi" ? s.nameHi : s.name }))} />
          <MonthNav month={month} locale={locale} maxMonth={monthOf(today)} hrefFor={(m) => `${base}&month=${m}`} labels={{ prev: t("attendance.register.prev"), next: t("attendance.register.next") }} />
        </div>
        {reg.lock && (
          <p className="flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900 ring-1 ring-brand-600/10">
            <Lock className="size-4" aria-hidden="true" /> {t("attendance.register.locked", { name: reg.lock.lockedByName, date: formatDate(toISODate(reg.lock.lockedAt), locale) })}
          </p>
        )}
        {reg.pendingMusterTaskId && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/15">{t("attendance.register.pendingBanner")}</p>}
        {reg.openRequests > 0 && !reg.lock && <p className="rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-900 ring-1 ring-violet-600/15">{t("attendance.register.openRequests", { count: reg.openRequests })}</p>}
        {reg.section.attendanceMode === "MANUAL" && <p className="text-sm text-ink-600">{t("attendance.register.manualHint")}</p>}
        <Card className="overflow-hidden">
          {reg.rows.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-600">{t("attendance.register.noStaff")}</p>
            </CardBody>
          ) : (
            <RegisterGrid rows={toGrid(reg.rows)} dates={reg.dates} holidays={reg.holidays} weeklyOff={reg.weeklyOff} sectionId={sectionId} month={month} today={reg.today} canEdit={reg.canEdit} />
          )}
        </Card>
        <Legend />
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

  async function lockTab() {
    const rules = await attendanceRules(actor.boardId);
    const due = lockDue(today, rules.lockDay);
    const month = sp.month && isMonth(sp.month) && sp.month < monthOf(today) ? sp.month : due.month;
    const rows = await lockOverview(actor, month);
    const isDueMonth = month === due.month;
    const canReopen = scopeFor(actor, "attendance", "lock") === "all";
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-2xl text-sm text-ink-600">{t("attendance.lock.tabHint", { month: formatMonth(month, locale), date: formatDate(due.due, locale) })}</p>
          <MonthNav month={month} locale={locale} maxMonth={due.month} hrefFor={(m) => `/attendance?tab=lock&month=${m}`} labels={{ prev: t("attendance.register.prev"), next: t("attendance.register.next") }} />
        </div>
        <Card>
          <Table stack>
            <THead>
              <tr>
                <Th>{t("attendance.register.section")}</Th>
                <Th align="right">{t("attendance.today.staff")}</Th>
                <Th>{t("common.status")}</Th>
                <Th />
              </tr>
            </THead>
            <tbody>
              {rows
                .filter((r) => r.staff > 0 || r.lock)
                .map((r) => (
                  <Tr key={r.section.id}>
                    <Td>
                      <p className="font-medium text-ink-900">{locale === "hi" ? r.section.nameHi : r.section.name}</p>
                      <p className="text-xs text-ink-500">{tDynamic(t, `attendance.mode.${r.section.attendanceMode}`)}</p>
                    </Td>
                    <Td align="right" label={t("attendance.today.staff")}>{r.staff}</Td>
                    <Td label={t("common.status")}>
                      {r.lock ? (
                        <div>
                          <Badge tone="green" dot>
                            {t("attendance.lock.locked")}
                          </Badge>
                          <p className="mt-1 text-xs text-ink-500">{t("attendance.lock.lockedSummary", { name: r.lock.lockedByName, date: formatDate(toISODate(r.lock.lockedAt), locale) })}</p>
                        </div>
                      ) : isDueMonth && due.overdue ? (
                        <Badge tone="red" dot>
                          {t("attendance.lock.overdue")}
                        </Badge>
                      ) : (
                        <Badge tone="amber" dot>
                          {isDueMonth ? t("attendance.lock.due", { date: formatDate(due.due, locale) }) : t("attendance.lock.notLocked")}
                        </Badge>
                      )}
                    </Td>
                    <Td align="right" actions>
                      <div className="flex flex-wrap justify-end gap-2">
                        <LinkButton href={`/attendance?tab=register&section=${r.section.id}&month=${month}`} size="sm" variant="ghost">
                          {t("attendance.tabs.register")}
                        </LinkButton>
                        {!r.lock && r.canLock && (
                          <LinkButton href={`/attendance/lock?section=${r.section.id}&month=${month}`} size="sm" variant="primary" icon={<Lock className="size-4" aria-hidden="true" />}>
                            {t("attendance.lock.review")}
                          </LinkButton>
                        )}
                        {r.lock && canReopen && <ReopenButton sectionId={r.section.id} month={month} />}
                      </div>
                    </Td>
                  </Tr>
                ))}
            </tbody>
          </Table>
        </Card>
      </div>
    );
  }

  async function requestsTab() {
    const rows = await openRequests(actor);
    return (
      <Card>
        <CardHeader
          title={t("attendance.requests.title")}
          icon={<Radio className="size-4.5" aria-hidden="true" />}
          actions={
            <LinkButton href="/approvals" size="sm">
              {t("attendance.requests.decideIn")}
            </LinkButton>
          }
        />
        {rows.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("attendance.requests.none")}</p>
          </CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("employees.columns.employee")}</Th>
                <Th>{t("attendance.my.date")}</Th>
                <Th>{t("attendance.my.type")}</Th>
                <Th>{t("attendance.my.reason")}</Th>
                <Th>{t("common.status")}</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <p className="font-medium text-ink-900">{(locale === "hi" && r.employee.nameHi) || fullName(r.employee)}</p>
                    <p className="text-xs text-ink-500">
                      {r.employee.employeeCode} · {locale === "hi" ? r.employee.section.nameHi : r.employee.section.name}
                    </p>
                  </Td>
                  <Td label={t("attendance.my.date")} className="whitespace-nowrap">{formatDate(toISODate(r.date), locale)}</Td>
                  <Td label={t("attendance.my.type")}>
                    {tDynamic(t, `attendance.requests.type.${r.type}`)}
                    {(r.inTime || r.outTime) && <span className="block text-xs text-ink-500">{[r.inTime && `${t("attendance.my.in")} ${r.inTime}`, r.outTime && `${t("attendance.my.out")} ${r.outTime}`].filter(Boolean).join(" · ")}</span>}
                  </Td>
                  <Td label={t("attendance.my.reason")} className="max-w-xs text-ink-600">{r.reason}</Td>
                  <Td label={t("common.status")}>
                    <Badge tone={REQUEST_TONE[r.status]} dot>
                      {tDynamic(t, `attendance.requests.status.${r.status}`)}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    );
  }

  async function importTab() {
    const [imports, settings] = await Promise.all([recentImports(actor), getSetting(actor.boardId, "attendance")]);
    return (
      <div className="space-y-6">
        <ImportPanel />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader title={t("attendance.import.recent")} />
            {imports.length === 0 ? (
              <CardBody>
                <p className="text-sm text-ink-600">{t("attendance.import.none")}</p>
              </CardBody>
            ) : (
              <Table stack>
                <THead>
                  <tr>
                    <Th>{t("attendance.import.file")}</Th>
                    <Th>{t("attendance.import.period")}</Th>
                    <Th align="right">{t("attendance.import.ready")}</Th>
                    <Th>{t("attendance.import.by")}</Th>
                  </tr>
                </THead>
                <tbody>
                  {imports.map((i) => (
                    <Tr key={i.id}>
                      <Td>
                        <p className="font-medium text-ink-900">{i.fileName}</p>
                        <p className="tabular text-xs text-ink-500" title={i.sha256}>
                          {tDynamic(t, `attendance.import.formats.${i.format}`)} · SHA-256 {i.sha256.slice(0, 12)}…
                        </p>
                      </Td>
                      <Td label={t("attendance.import.period")} className="whitespace-nowrap">
                        {formatDate(toISODate(i.fromDate), locale)} – {formatDate(toISODate(i.toDate), locale)}
                      </Td>
                      <Td align="right" label={t("attendance.import.ready")}>{i.savedCount}</Td>
                      <Td label={t("attendance.import.by")}>
                        <p>{i.createdByName}</p>
                        <p className="text-xs text-ink-500">{formatDateTime(i.createdAt, locale)}</p>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title={t("attendance.import.device")} icon={<Radio className="size-4.5" aria-hidden="true" />} />
            <CardBody className="space-y-3 text-sm text-ink-600">
              <p>{t("attendance.import.deviceHint", { url: `${env().APP_URL}/iclock/cdata` })}</p>
              <Badge tone={settings.devices.length ? "green" : "gray"}>{t("attendance.import.devicesCount", { count: settings.devices.length })}</Badge>
              {settings.devices.length > 0 && (
                <ul className="space-y-1">
                  {settings.devices.map((d) => (
                    <li key={d.serial} className="tabular text-xs">
                      {d.serial} · {d.name}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  function Legend() {
    const codes = ["PRESENT", "LATE", "HALF_DAY", "ABSENT", "MISSED_PUNCH", "ON_DUTY", "LEAVE", "HOLIDAY", "WEEKLY_OFF", "DIES_NON"] as const;
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-600" aria-label={t("attendance.register.legend")}>
        {codes.map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5">
            <span className={cn("flex h-5 min-w-6 items-center justify-center rounded px-1 text-[0.65rem]", CELL[c])}>{STATUS_CODE[c]}</span>
            {tDynamic(t, `attendance.status.${c}`)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="flex h-5 min-w-6 items-center justify-center rounded bg-amber-50/60 px-1 text-amber-500 ring-1 ring-inset ring-amber-300">·</span>
          {t("attendance.today.unmarked")}
        </span>
      </div>
    );
  }
}

