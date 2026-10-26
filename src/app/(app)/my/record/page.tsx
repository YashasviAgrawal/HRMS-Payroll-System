import type { Metadata } from "next";
import { Send } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireActor } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { getEmployee } from "@/modules/employees/service";
import { EmployeeProfile, PROFILE_TABS, type ProfileTab } from "../../employees/_components/profile";

export const metadata: Metadata = { title: "My record" };

export default async function MyRecordPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireActor();
  if (!actor.employeeId) return <NoAccess />;
  const { t, locale } = await getT();
  const { tab } = await searchParams;
  const e = await getEmployee(actor, actor.employeeId);
  const active = (PROFILE_TABS as readonly string[]).includes(tab ?? "") && tab !== "history" ? (tab as ProfileTab) : "personal";
  return (
    <div>
      <PageHeader
        title={t("my.recordTitle")}
        description={t("my.recordSubtitle")}
        actions={
          actor.isEmployee && (
            <LinkButton href="/my/requests?new=1" variant="primary" icon={<Send className="size-4" aria-hidden="true" />}>
              {t("my.requestChange")}
            </LinkButton>
          )
        }
      />
      <EmployeeProfile e={e} actor={actor} tab={active} t={t} locale={locale} mode="self" basePath="/my/record" />
    </div>
  );
}
