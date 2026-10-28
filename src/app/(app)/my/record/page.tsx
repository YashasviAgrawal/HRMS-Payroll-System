import type { Metadata } from "next";
import { Send } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireActor } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { getEmployee } from "@/modules/employees/service";
import { ownRecordState } from "@/modules/migration/verify";
import { ConfirmMyRecord } from "../../migration/_components/actions";
import { EmployeeProfile, HR_ONLY_TABS, PROFILE_TABS, type ProfileTab } from "../../employees/_components/profile";
import { PensionRecord } from "./pension-record";

export const metadata: Metadata = { title: "My record" };

export default async function MyRecordPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireActor();
  // PN-12: a pensioner (retired, or a family pensioner with no service of their own) sees the pension record.
  if (actor.pensionerId && !actor.isEmployee) return <PensionRecord actor={actor} />;
  if (!actor.employeeId) return <NoAccess />;
  const { t, locale } = await getT();
  const { tab } = await searchParams;
  const [e, confirm] = await Promise.all([getEmployee(actor, actor.employeeId), ownRecordState(actor)]);
  const active = (PROFILE_TABS as readonly string[]).includes(tab ?? "") && !HR_ONLY_TABS.includes(tab as ProfileTab) ? (tab as ProfileTab) : "personal";
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
      {/* §15 step 7: while the migration is open, each person confirms their own record. */}
      {confirm && (
        <div className="mb-5">
          <ConfirmMyRecord confirmedAt={confirm.confirmedAt} changeHref="/my/requests?new=1" />
        </div>
      )}
      <EmployeeProfile e={e} actor={actor} tab={active} t={t} locale={locale} mode="self" basePath="/my/record" />
    </div>
  );
}
