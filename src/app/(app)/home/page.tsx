import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarHeart, CheckCircle2, Clock, Fingerprint, History, Hourglass, IdCard, Inbox, Landmark, LayoutGrid, Lock, UserPlus, Users, Wallet } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import { requireActor } from "@/lib/auth/session";
import { formatDate, formatDateTime, todayIST } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { homeTiles, myWork } from "@/modules/home/service";

export const metadata: Metadata = { title: "Home" };

const TILE_ICONS = { users: Users, sections: LayoutGrid, employees: IdCard, history: History, inbox: Inbox, probation: Hourglass, joining: UserPlus, attendance: Fingerprint, lock: Lock, leave: CalendarHeart, payroll: Wallet, statutory: Landmark };

function greetingKey(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(now));
  return hour < 12 ? "home.goodMorning" : hour < 17 ? "home.goodAfternoon" : "home.goodEvening";
}

export default async function HomePage() {
  const actor = await requireActor();
  const { t, locale } = await getT();
  const [work, tiles] = await Promise.all([myWork(actor), homeTiles(actor)]);
  const firstName = (locale === "hi" && actor.nameHi ? actor.nameHi : actor.name).split(" ")[0];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-brand-700">{formatDate(todayIST(), locale)}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-950 sm:text-3xl">
            {tDynamic(t, greetingKey(), { name: firstName })}
          </h1>
        </div>
      </div>

      {tiles.length > 0 && (
        <section aria-labelledby="glance">
          <h2 id="glance" className="sr-only">
            {t("home.atAGlance")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {tiles.map((tile) => {
              const Icon = TILE_ICONS[tile.icon];
              return (
                <StatTile
                  key={tile.key}
                  label={tDynamic(t, `home.${tile.key}`)}
                  value={tile.value}
                  href={tile.href}
                  tone={tile.tone}
                  icon={<Icon className="size-4.5" aria-hidden="true" />}
                />
              );
            })}
          </div>
        </section>
      )}

      <Card>
        <CardHeader
          title={t("home.myWork")}
          description={work.length ? t("home.approvalsWaitingHint") : undefined}
          icon={<Inbox className="size-4.5" aria-hidden="true" />}
          actions={
            work.length ? (
              <Link href="/approvals" className="text-sm font-medium text-brand-700 hover:underline">
                {t("common.viewAll")}
              </Link>
            ) : undefined
          }
        />
        {work.length === 0 ? (
          <EmptyState icon={<CheckCircle2 className="size-6" aria-hidden="true" />} title={t("home.myWorkEmpty")} description={t("home.setupNote")} />
        ) : (
          <ul className="divide-y divide-ink-100">
            {work.map((item) => (
              <li key={item.key}>
                <Link href={item.href} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-brand-50/40 sm:px-6">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                    <Clock className="size-4.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.95rem] font-medium text-ink-900">
                      {locale === "hi" && item.titleHi ? item.titleHi : item.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-500">
                      {item.meta && t("approvals.raisedBy", { name: item.meta })}
                      {item.at && ` · ${formatDateTime(item.at, locale)}`}
                    </span>
                  </span>
                  <ArrowRight className="size-4 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
