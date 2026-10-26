import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { BulkUpload } from "./bulk-upload";

export const metadata: Metadata = { title: "Bulk upload" };

export default async function BulkPage() {
  const actor = await requireActor();
  if (!canAll(actor, "employee_master", "create")) return <NoAccess />;
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader breadcrumbs={[{ label: t("employees.title"), href: "/employees" }, { label: t("employees.bulk.title") }]} title={t("employees.bulk.title")} description={t("employees.bulk.subtitle")} />
      <BulkUpload />
    </div>
  );
}
