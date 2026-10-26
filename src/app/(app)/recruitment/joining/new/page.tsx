import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { formOptions } from "../../../employees/_components/options";
import { DirectJoiningForm } from "./direct-form";

export const metadata: Metadata = { title: "New contract worker" };

export default async function DirectJoiningPage() {
  const actor = await requireActor();
  if (!canAll(actor, "employee_master", "create")) return <NoAccess />;
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader breadcrumbs={[{ label: t("recruitment.title"), href: "/recruitment?tab=joining" }, { label: t("recruitment.joining.directTitle") }]} title={t("recruitment.joining.directTitle")} description={t("recruitment.joining.directSubtitle")} />
      <DirectJoiningForm {...await formOptions(actor.boardId)} />
    </div>
  );
}
