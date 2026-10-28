import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { getSetting } from "@/modules/settings/service";
import { ServiceBookUploader } from "./uploader";

export const metadata: Metadata = { title: "Scanned service books" };

/** Client add-on: scanned service books of existing and older staff, many at once, matched by Employee ID. */
export default async function ServiceBooksPage() {
  const actor = await requireActor();
  if (!canAll(actor, "employee_master", "create")) return <NoAccess />;
  const { t } = await getT();
  const types = (await getSetting(actor.boardId, "documents")).types;
  const maxMb = types.find((x) => x.code === "SERVICE_BOOK")?.maxMb ?? 50;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader breadcrumbs={[{ label: t("employees.title"), href: "/employees" }, { label: t("employees.serviceBookScans.title") }]} title={t("employees.serviceBookScans.title")} description={t("employees.serviceBookScans.subtitle")} />
      <ServiceBookUploader maxMb={maxMb} />
    </div>
  );
}
