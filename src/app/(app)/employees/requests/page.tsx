import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink } from "@/components/ui/row-link";
import { Table, Td, Th, THead } from "@/components/ui/table";
import { decisionBlocker } from "@/lib/approvals";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { employeeRequests } from "@/modules/employees/records";

export const metadata: Metadata = { title: "Change requests" };

export default async function EmployeeRequestsPage() {
  const actor = await requireActor();
  if (!canAll(actor, "employee_master", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const tasks = await employeeRequests(actor);
  return (
    <div>
      <PageHeader breadcrumbs={[{ label: t("employees.title"), href: "/employees" }, { label: t("employees.requestsPage.title") }]} title={t("employees.requestsPage.title")} description={t("employees.requestsPage.subtitle")} />
      <Card>
        {tasks.length === 0 ? (
          <EmptyState icon={<CheckCircle2 className="size-6" aria-hidden="true" />} title={t("employees.requestsPage.empty")} />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>{t("employees.requestsPage.record")}</Th>
                <Th>{t("employees.requestsPage.raisedBy")}</Th>
                <Th>{t("audit.when")}</Th>
                <Th>{t("common.waiting")}</Th>
              </tr>
            </THead>
            <tbody>
              {tasks.map((task) => {
                const mine = decisionBlocker(actor, task) === null;
                return (
                  <RowLink key={task.id} href={`/approvals/${task.id}`}>
                    <Td className="font-medium text-ink-900">{locale === "hi" && task.titleHi ? task.titleHi : task.title}</Td>
                    <Td className="whitespace-nowrap">{task.makerName}</Td>
                    <Td className="whitespace-nowrap text-ink-600">{formatDateTime(task.createdAt, locale)}</Td>
                    <Td>
                      <Badge tone={mine ? "amber" : "gray"} dot>
                        {mine ? t("shell.waitingForYou") : tDynamic(t, `permission.${task.requiredPermission}`)}
                      </Badge>
                    </Td>
                  </RowLink>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
