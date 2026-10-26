import type { Metadata } from "next";
import { CheckCircle2, Inbox } from "lucide-react";
import type { ApprovalTask } from "@/generated/prisma/client";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink } from "@/components/ui/row-link";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, THead } from "@/components/ui/table";
import { countInbox, listDecidedBy, listInbox, listRaisedBy } from "@/lib/approvals";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Approvals" };

const STATUS_TONE: Record<string, Tone> = { PENDING: "amber", APPROVED: "green", REJECTED: "red", RETURNED: "blue", CANCELLED: "gray" };
const STATUS_KEY: Record<string, string> = {
  PENDING: "approvals.pending",
  APPROVED: "approvals.approved",
  REJECTED: "approvals.rejected",
  RETURNED: "approvals.returned",
  CANCELLED: "common.inactive",
};

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireActor();
  const { t, locale } = await getT();
  const { tab = "pending" } = await searchParams;
  const [pendingCount, rows] = await Promise.all([
    countInbox(actor),
    tab === "mine" ? listRaisedBy(actor) : tab === "decided" ? listDecidedBy(actor) : listInbox(actor),
  ]);

  const title = (task: ApprovalTask) => (locale === "hi" && task.titleHi ? task.titleHi : task.title);

  return (
    <div>
      <PageHeader title={t("approvals.title")} description={t("approvals.subtitle")} />
      <LinkTabs
        className="mb-5"
        active={tab}
        tabs={[
          { key: "pending", label: t("approvals.pending"), href: "/approvals", count: pendingCount },
          { key: "mine", label: t("approvals.myRequests"), href: "/approvals?tab=mine" },
          { key: "decided", label: t("approvals.history"), href: "/approvals?tab=decided" },
        ]}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={tab === "pending" ? <CheckCircle2 className="size-6" aria-hidden="true" /> : <Inbox className="size-6" aria-hidden="true" />}
            title={tab === "pending" ? t("approvals.empty") : t("common.noData")}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>{t("approvals.whatChanges")}</Th>
                <Th>{t("audit.who")}</Th>
                <Th>{t("audit.when")}</Th>
                <Th>{t("common.status")}</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((task) => (
                <RowLink key={task.id} href={`/approvals/${task.id}`}>
                  <Td>
                    <p className="font-medium text-ink-900">{title(task)}</p>
                    <p className="mt-0.5 text-xs text-ink-500">{tDynamic(t, `permission.${task.requiredPermission}`)}</p>
                  </Td>
                  <Td className="whitespace-nowrap">{task.makerName}</Td>
                  <Td className="whitespace-nowrap text-ink-600">{formatDateTime(task.createdAt, locale)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[task.status]} dot>
                      {tDynamic(t, STATUS_KEY[task.status])}
                    </Badge>
                  </Td>
                </RowLink>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
