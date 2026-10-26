import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { requireActor } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { UserForm } from "../user-form";

export const metadata: Metadata = { title: "Add user" };

export default async function NewUserPage() {
  const actor = await requireActor();
  if (!actor.permissions.includes("USER_SETTINGS_MANAGER")) return <NoAccess />;
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader breadcrumbs={[{ label: t("users.title"), href: "/admin/users" }, { label: t("users.add") }]} title={t("users.add")} description={t("users.subtitle")} />
      <UserForm mode="create" />
    </div>
  );
}
