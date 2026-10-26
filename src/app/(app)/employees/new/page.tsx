import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { formOptions } from "../_components/options";
import { CreateEmployeeForm } from "./create-form";

export const metadata: Metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const actor = await requireActor();
  if (!canAll(actor, "employee_master", "create")) return <NoAccess />;
  const { t } = await getT();
  const options = await formOptions(actor.boardId);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader breadcrumbs={[{ label: t("employees.title"), href: "/employees" }, { label: t("employees.create.title") }]} title={t("employees.create.title")} description={t("employees.create.subtitle")} />
      <CreateEmployeeForm {...options} />
    </div>
  );
}
