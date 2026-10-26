import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CalendarCheck, CalendarClock, CircleCheck } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { statutoryCalendar } from "@/modules/statutory/calendar-service";
import { STATE_TONE, StatutoryTabs } from "./_components/statutory-tabs";

export const metadata: Metadata = { title: "Statutory and tax" };

/** ST-08, S-52: the statutory calendar — what is due, what is done, what is late. */
export default async function StatutoryPage() {
  const actor = await requireActor();
  if (!canAll(actor, "statutory", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const { items } = await statutoryCalendar(actor);
  const overdue = items.filter((i) => i.state === "OVERDUE");
  const week = items.filter((i) => i.state === "OPEN" && i.daysLeft <= 7);
  const done = items.filter((i) => i.state === "DONE");
  const when = (days: number) => (days === 0 ? t("statutory.calendar.today") : days > 0 ? t("statutory.calendar.daysLeft", { days }) : t("statutory.calendar.daysLate", { days: -days }));

  return (
    <div>
      <PageHeader title={t("statutory.title")} description={t("statutory.subtitle")} />
      <StatutoryTabs active="calendar" t={t} />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatTile label={t("statutory.calendar.overdue")} value={overdue.length} tone={overdue.length ? "red" : "gray"} icon={<AlarmClock className="size-4.5" aria-hidden="true" />} />
        <StatTile label={t("statutory.calendar.dueWeek")} value={week.length} tone={week.length ? "amber" : "gray"} icon={<CalendarClock className="size-4.5" aria-hidden="true" />} />
        <StatTile label={t("statutory.calendar.done")} value={done.length} tone="green" icon={<CircleCheck className="size-4.5" aria-hidden="true" />} />
      </div>
      <Card>
        <CardHeader title={t("statutory.calendar.list")} description={t("statutory.calendar.listHelp")} icon={<CalendarCheck className="size-4.5" aria-hidden="true" />} />
        {items.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("statutory.calendar.none")}</p>
          </CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("statutory.calendar.due")}</Th>
                <Th>{t("statutory.calendar.what")}</Th>
                <Th>{t("statutory.calendar.for")}</Th>
                <Th>{t("statutory.status")}</Th>
                <Th />
              </tr>
            </THead>
            <tbody>
              {items.map((i) => (
                <Tr key={`${i.code}|${i.dueOn}`}>
                  <Td>
                    <span className="font-medium text-ink-900">{formatDate(i.dueOn, locale)}</span>
                    {i.state !== "DONE" && i.state !== "NOTHING" && <span className={i.state === "OVERDUE" ? "block text-xs font-medium text-red-700" : "block text-xs text-ink-500"}>{when(i.daysLeft)}</span>}
                  </Td>
                  <Td label={t("statutory.calendar.what")} className="text-ink-900">
                    {locale === "hi" ? i.nameHi : i.name}
                  </Td>
                  <Td label={t("statutory.calendar.for")} className="tabular text-ink-600">
                    {i.period}
                  </Td>
                  <Td label={t("statutory.status")}>
                    <Badge tone={STATE_TONE[i.state]} dot>
                      {tDynamic(t, `statutory.state.${i.state}`)}
                    </Badge>
                  </Td>
                  <Td align="right" actions>
                    <Link href={i.href} className="text-sm font-medium text-brand-700 hover:underline">
                      {t("statutory.open")}
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
