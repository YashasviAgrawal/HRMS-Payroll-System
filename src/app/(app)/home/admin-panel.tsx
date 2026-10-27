import Link from "next/link";
import { CalendarClock, Landmark, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { formatDate, formatMonth } from "@/lib/dates";
import { tDynamic, type TFunction } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/types";
import type { adminPanel } from "@/modules/home/service";

type Panel = NonNullable<Awaited<ReturnType<typeof adminPanel>>>;

const more = (href: string, label: string) => (
  <Link href={href} className="text-sm font-medium text-brand-700 hover:underline">
    {label}
  </Link>
);

/** §11 Admin: headcount by type (one series, so one hue and the numbers written on), retirements and filings due. */
export function AdminPanel({ panel, t, locale }: { panel: Panel; t: TFunction; locale: Locale }) {
  const max = Math.max(1, ...panel.headcount.map((h) => h.count));
  const total = panel.headcount.reduce((a, h) => a + h.count, 0);
  return (
    <section aria-label={t("home.boardAtAGlance")} className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
      <Card>
        <CardHeader title={t("home.headcountByType")} description={t("home.onRollsTotal", { n: total })} icon={<Users className="size-4.5" aria-hidden="true" />} actions={more("/reports/headcount", t("home.seeReport"))} />
        <ul className="space-y-3.5 px-5 py-5 sm:px-6">
          {panel.headcount.map((h) => {
            const label = tDynamic(t, `employees.type.${h.type}`);
            return (
              <li key={h.type} title={`${label}: ${h.count}`}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-ink-700">{label}</span>
                  <span className="tabular font-semibold text-ink-900">{h.count}</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-ink-100" aria-hidden="true">
                  <div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.max(2, (h.count / max) * 100)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader title={t("home.retiringList")} description={t("home.next6Months")} icon={<CalendarClock className="size-4.5" aria-hidden="true" />} actions={more("/reports/retirements-probation", t("home.seeReport"))} />
        {panel.retiring.length === 0 ? (
          <p className="px-5 py-5 text-sm text-ink-500 sm:px-6">{t("home.noneRetiring")}</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {panel.retiring.map((r) => (
              <li key={r.id}>
                <Link href={`/employees/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-brand-50/40 sm:px-6">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink-900">{locale === "hi" && r.nameHi ? r.nameHi : r.name}</span>
                    <span className="block truncate text-xs text-ink-500">{locale === "hi" ? r.postHi : r.post}</span>
                  </span>
                  <span className="tabular shrink-0 text-sm text-ink-700">{formatDate(r.date, locale)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={t("home.dueDates")} icon={<Landmark className="size-4.5" aria-hidden="true" />} actions={more("/statutory", t("common.viewAll"))} />
        {panel.due.length === 0 ? (
          <p className="px-5 py-5 text-sm text-ink-500 sm:px-6">{t("home.noneDue")}</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {panel.due.map((d) => (
              <li key={`${d.code}-${d.period}`} className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink-900">{locale === "hi" ? d.nameHi : d.name}</span>
                  <span className="block text-xs text-ink-500">{/^\d{4}-\d{2}$/.test(d.period) ? formatMonth(d.period, locale) : d.period}</span>
                </span>
                <Badge tone={d.state === "OVERDUE" ? "red" : d.daysLeft <= 5 ? "amber" : "gray"}>{formatDate(d.dueOn, locale)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
