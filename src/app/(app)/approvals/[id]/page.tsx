import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Clock, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { decisionBlocker, getTask } from "@/lib/approvals";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { DecisionPanel } from "./decision-panel";

export const metadata: Metadata = { title: "Approval" };

export default async function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { t, locale } = await getT();
  const { id } = await params;
  const { task, mayDecide } = await getTask(actor, id);
  const details = (task.details ?? {}) as ApprovalDetails;
  const blocker = task.status === "PENDING" ? decisionBlocker(actor, task) : null;
  const hasOld = details.rows?.some((r) => r.old !== undefined && r.old !== null);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumbs={[{ label: t("approvals.title"), href: "/approvals" }, { label: locale === "hi" && task.titleHi ? task.titleHi : task.title }]}
        title={locale === "hi" && task.titleHi ? task.titleHi : task.title}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="size-4" aria-hidden="true" /> {t("approvals.raisedBy", { name: task.makerName })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-4" aria-hidden="true" /> {formatDateTime(task.createdAt, locale)}
            </span>
          </span>
        }
        actions={<Badge tone="green">{tDynamic(t, `permission.${task.requiredPermission}`)}</Badge>}
      />

      <div className="grid gap-6">
        <Card>
          <CardHeader
            title={t("approvals.whatChanges")}
            description={locale === "hi" && details.summaryHi ? details.summaryHi : details.summary}
            actions={
              details.link ? (
                <Link href={details.link} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                  {t("common.open")} <ArrowUpRight className="size-4" aria-hidden="true" />
                </Link>
              ) : undefined
            }
          />
          {details.rows && details.rows.length > 0 ? (
            <Table>
              <THead>
                <tr>
                  <Th>{t("approvals.field")}</Th>
                  {hasOld && <Th>{t("approvals.oldValue")}</Th>}
                  <Th>{hasOld ? t("approvals.newValue") : t("common.details")}</Th>
                </tr>
              </THead>
              <tbody>
                {details.rows.map((row, i) => (
                  <Tr key={i}>
                    <Td className="font-medium text-ink-700">{locale === "hi" && row.labelHi ? row.labelHi : row.label}</Td>
                    {hasOld && <Td className="text-ink-500 line-through decoration-ink-300">{row.old ?? "—"}</Td>}
                    <Td className="font-medium text-ink-900">{row.new ?? "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <CardBody>
              <p className="text-sm text-ink-500">{t("common.noData")}</p>
            </CardBody>
          )}
          {task.makerNote && (
            <CardBody className="border-t border-ink-100">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{t("common.note")}</p>
              <p className="mt-1 text-sm text-ink-800">{task.makerNote}</p>
            </CardBody>
          )}
        </Card>

        {task.status === "PENDING" && mayDecide ? (
          <DecisionPanel taskId={task.id} makerName={task.makerName} />
        ) : (
          <Card>
            <CardBody className="text-sm text-ink-600">
              {task.status !== "PENDING" ? (
                <p>
                  <span className="font-medium text-ink-900">{task.deciderName}</span> · {formatDateTime(task.decidedAt, locale)}
                  {task.decisionNote && <span className="mt-2 block text-ink-700">“{task.decisionNote}”</span>}
                </p>
              ) : (
                <p>{blocker ? tDynamic(t, blocker) : t("approvals.pending")}</p>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
