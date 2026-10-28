import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Briefcase, Database, History, Landmark, Scale, Settings, Users, type LucideIcon } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { adminTools } from "@/lib/auth/menu";
import { requireActor } from "@/lib/auth/session";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Administration" };

const ICONS: Record<string, LucideIcon> = { statutory: Landmark, recruitment: Briefcase, users: Users, rates: Scale, settings: Settings, migration: Database, audit: History };

/** The Admin's other screens, when the menu's eight places are taken by the Board's records (client add-on). */
export default async function AdministrationPage() {
  const actor = await requireActor();
  const tools = adminTools(actor);
  if (!tools.length) return <NoAccess />;
  const { t } = await getT();
  return (
    <div>
      <PageHeader title={t("nav.admin")} description={t("adminHub.subtitle")} />
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="admin-hub">
        {tools.map((x) => {
          const Icon = ICONS[x.key] ?? Settings;
          return (
            <li key={x.key}>
              <Card className="h-full transition-shadow hover:shadow-raised">
                <Link href={x.href} className="group flex h-full items-start gap-4 p-5">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700" aria-hidden="true">
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-semibold text-ink-900 group-hover:text-brand-800">
                      {tDynamic(t, `nav.${x.key}`)}
                      <ArrowRight className="size-4 text-ink-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                    <span className="mt-1 block text-sm text-ink-600">{tDynamic(t, `adminHub.${x.key}`)}</span>
                  </span>
                </Link>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
