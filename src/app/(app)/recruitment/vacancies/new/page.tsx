import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { formOptions } from "../../../employees/_components/options";
import { VacancyForm } from "./vacancy-form";

export const metadata: Metadata = { title: "New vacancy" };

export default async function NewVacancyPage() {
  const actor = await requireActor();
  if (!canAll(actor, "recruitment", "create")) return <NoAccess />;
  const { t } = await getT();
  const options = await formOptions(actor.boardId);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader breadcrumbs={[{ label: t("recruitment.title"), href: "/recruitment" }, { label: t("recruitment.newVacancy") }]} title={t("recruitment.newVacancy")} description={t("recruitment.newVacancySubtitle")} />
      <VacancyForm {...options} />
    </div>
  );
}
