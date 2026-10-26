import type { Metadata } from "next";
import { UsersRound } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { listEmployees } from "@/modules/employees/service";

export const metadata: Metadata = { title: "My team" };

/** Reporting officers see the staff of their own section (PRD §2 rule 5). Attendance and leave tools join in Modules 4–5. */
export default async function MyTeamPage() {
  const actor = await requireActor();
  if (!actor.permissions.includes("REPORTING_OFFICER") || !actor.sectionId) return <NoAccess />;
  const { t, locale } = await getT();
  const [data, section] = await Promise.all([listEmployees(actor, { pageSize: 200 }), db.section.findUnique({ where: { id: actor.sectionId } })]);
  return (
    <div>
      <PageHeader title={t("my.teamTitle")} description={t("my.teamSubtitle", { section: (locale === "hi" ? section?.nameHi : section?.name) ?? "—" })} />
      <Card>
        {data.rows.length === 0 ? (
          <EmptyState icon={<UsersRound className="size-6" aria-hidden="true" />} title={t("common.noData")} />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>{t("employees.columns.employee")}</Th>
                <Th>{t("employees.columns.post")}</Th>
                <Th>{t("employees.columns.type")}</Th>
                <Th>{t("common.mobile")}</Th>
              </tr>
            </THead>
            <tbody>
              {data.rows.map((e) => (
                <Tr key={e.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={e.name} size="sm" />
                      <div>
                        <p className="font-medium text-ink-900">{locale === "hi" && e.nameHi ? e.nameHi : e.name}</p>
                        <p className="tabular text-xs text-ink-500">{e.employeeCode}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>{locale === "hi" ? e.post.nameHi : e.post.name}</Td>
                  <Td>
                    <Badge tone="gray">{tDynamic(t, `employees.type.${e.type}`)}</Badge>
                  </Td>
                  <Td className="tabular">{e.mobile ?? "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
