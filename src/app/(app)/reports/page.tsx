import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, ChevronRight, HandCoins, Landmark, ShieldAlert, Users, Wallet } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { AREAS, reportsFor } from "@/modules/reports/registry";
import type { Area } from "@/modules/reports/types";

export const metadata: Metadata = { title: "Reports" };

const ICON: Record<Area, React.ReactNode> = {
  employees: <Users className="size-4.5" aria-hidden="true" />,
  attendance: <CalendarCheck className="size-4.5" aria-hidden="true" />,
  payroll: <Wallet className="size-4.5" aria-hidden="true" />,
  statutory: <Landmark className="size-4.5" aria-hidden="true" />,
  pension: <HandCoins className="size-4.5" aria-hidden="true" />,
  control: <ShieldAlert className="size-4.5" aria-hidden="true" />,
};

/** S-70: the standard reports of PRD §11 this login may open, by area. */
export default async function ReportsPage() {
  const actor = await requireActor();
  if (!can(actor, "reports", "view")) return <NoAccess />;
  const { t } = await getT();
  const mine = reportsFor(actor);
  return (
    <div>
      <PageHeader title={t("reports.title")} description={t("reports.subtitle")} />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {AREAS.map((area) => {
          const list = mine.filter((r) => r.area === area);
          if (!list.length) return null;
          return (
            <Card key={area}>
              <CardHeader title={tDynamic(t, `reports.areas.${area}`)} icon={ICON[area]} />
              <ul className="divide-y divide-ink-100">
                {list.map((r) => (
                  <li key={r.key}>
                    <Link href={`/reports/${r.key}`} className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-brand-50/40 focus-visible:bg-brand-50/60 focus-visible:outline-none sm:px-6">
                      <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-sm font-semibold text-ink-700 group-hover:bg-brand-100 group-hover:text-brand-800">{r.no}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-ink-900">{tDynamic(t, `reports.titles.r${r.no}`)}</span>
                        <span className="mt-0.5 block text-sm text-ink-500">{tDynamic(t, `reports.descs.r${r.no}`)}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-ink-300 group-hover:text-brand-700" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      {mine.length === 0 && <p className="text-sm text-ink-500">{t("reports.noneForYou")}</p>}
    </div>
  );
}
