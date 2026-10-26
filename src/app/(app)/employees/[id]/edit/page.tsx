import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { getFamily } from "@/modules/employees/records";
import { getEmployee } from "@/modules/employees/service";
import { formOptions } from "../../_components/options";
import { EditEmployeeForm, type EditTabKey } from "./edit-form";

export const metadata: Metadata = { title: "Edit employee" };

const TABS: EditTabKey[] = ["personal", "job", "ids", "family"];

export default async function EditEmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "employee_master", "create")) return <NoAccess />;
  const { t } = await getT();
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: EditTabKey = TABS.includes(rawTab as EditTabKey) ? (rawTab as EditTabKey) : "personal";
  const [e, options, family] = await Promise.all([getEmployee(actor, id), formOptions(actor.boardId), getFamily(actor, id)]);
  if (e.id === actor.employeeId) return <NoAccess />;
  const tabLabel = t(`employees.tabs.${tab}`);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumbs={[{ label: t("employees.title"), href: "/employees" }, { label: e.employeeCode ?? e.name, href: `/employees/${e.id}?tab=${tab}` }, { label: t("employees.profile.edit") }]}
        title={t("employees.edit.title", { tab: tabLabel })}
        description={e.status === "DRAFT" ? t("employees.edit.draftSubtitle") : t("employees.edit.subtitle")}
      />
      <EditEmployeeForm
        tab={tab}
        employee={e}
        family={{
          members: family.members.map((m) => ({ id: m.id, name: m.name, nameHi: m.nameHi ?? "", relation: m.relation, gender: m.gender ?? "", dateOfBirth: m.dateOfBirth ?? "", isDependent: m.isDependent, isDisabled: m.isDisabled, isAlive: m.isAlive })),
          nominees: family.nominees.map((n) => ({ scheme: n.scheme, memberIndex: family.members.findIndex((m) => m.id === n.familyMemberId), sharePercent: n.sharePercent })),
        }}
        {...options}
      />
    </div>
  );
}
