import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireActor } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { getEmployee } from "@/modules/employees/service";
import { EmployeeProfile, PROFILE_TABS, type ProfileTab } from "../_components/profile";

export const metadata: Metadata = { title: "Employee" };

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; view?: string; month?: string; fy?: string; year?: string }> }) {
  const actor = await requireActor();
  const { t, locale } = await getT();
  const { id } = await params;
  const { tab, ...filters } = await searchParams;
  const e = await getEmployee(actor, id);
  // Opens on the overview: the whole person on one screen (client add-on).
  const active = (PROFILE_TABS as readonly string[]).includes(tab ?? "") ? (tab as ProfileTab) : "overview";
  return (
    <div>
      <PageHeader className="mb-4" breadcrumbs={[{ label: t("employees.title"), href: "/employees" }, { label: e.employeeCode ?? e.name }]} title="" />
      <EmployeeProfile e={e} actor={actor} tab={active} t={t} locale={locale} mode="hr" basePath={`/employees/${e.id}`} filters={filters} />
    </div>
  );
}
