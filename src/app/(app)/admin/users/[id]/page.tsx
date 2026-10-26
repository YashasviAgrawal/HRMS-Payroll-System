import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { getUser } from "@/modules/users/service";
import { UserForm } from "../user-form";

export const metadata: Metadata = { title: "Edit user" };

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (!can(actor, "users_settings", "view")) return <NoAccess />;
  const { t } = await getT();
  const { id } = await params;
  const user = await getUser(actor, id);
  const canEdit = actor.permissions.includes("USER_SETTINGS_MANAGER");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader breadcrumbs={[{ label: t("users.title"), href: "/admin/users" }, { label: user.displayName }]} title={user.displayName} description={canEdit ? t("users.edit") : t("users.readOnly")} />
      <UserForm
        mode="edit"
        readOnly={!canEdit}
        isSelf={user.id === actor.userId}
        initial={{
          id: user.id,
          loginType: user.loginType,
          loginId: user.loginId,
          displayName: user.displayName,
          displayNameHi: user.displayNameHi ?? "",
          mobile: user.mobile,
          email: user.email ?? "",
          permissions: user.permissions,
          status: user.status,
          employee: user.employee
            ? {
                id: user.employee.id,
                employeeCode: user.employee.employeeCode,
                name: [user.employee.firstName, user.employee.lastName].filter(Boolean).join(" "),
                section: user.employee.section.name,
                sectionHi: user.employee.section.nameHi,
              }
            : null,
        }}
      />
    </div>
  );
}
