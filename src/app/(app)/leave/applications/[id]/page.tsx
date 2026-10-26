import type { Metadata } from "next";
import { FileText, Inbox, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClass, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireActor } from "@/lib/auth/session";
import { formatDate, formatDateTime, todayIST, toISODate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { fullName } from "@/modules/employees/present";
import { canEnterLeave, getApplication } from "@/modules/leave/service";
import { WithdrawButton } from "../../../employees/_components/widgets";
import { BalanceCards } from "../../_components/balance-cards";
import { LEAVE_TONE } from "../../_components/tones";
import { CancelLeaveButton } from "./cancel-button";

export const metadata: Metadata = { title: "Leave application" };

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const { t, locale } = await getT();
  const { application: a, employee: e, type, task, balances } = await getApplication(actor, id);
  const own = actor.employeeId === e.id;
  const canCancel = a.status === "APPROVED" && ((own && toISODate(a.fromDate) > todayIST()) || canEnterLeave(actor));
  const canDecide = task?.status === "PENDING" && actor.permissions.includes(task.requiredPermission) && task.makerId !== actor.userId && e.id !== actor.employeeId;
  const name = (locale === "hi" && e.nameHi) || fullName(e);
  const dates = a.fromDate.getTime() === a.toDate.getTime() ? formatDate(toISODate(a.fromDate), locale) : `${formatDate(toISODate(a.fromDate), locale)} – ${formatDate(toISODate(a.toDate), locale)}`;
  const back = own ? "/leave" : actor.loginType === "EMPLOYEE" ? "/my/team/leave" : "/leave/manage";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        breadcrumbs={[{ label: own ? t("leave.title") : actor.loginType === "EMPLOYEE" ? t("leave.team.title") : t("leave.title"), href: back }, { label: t("leave.application.title") }]}
        title={`${(locale === "hi" ? type?.nameHi : type?.name) ?? a.leaveCode} · ${fmt(Number(a.days))}`}
        description={`${name} · ${e.employeeCode} · ${dates}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={LEAVE_TONE[a.status]} dot>
              {tDynamic(t, `leave.status.${a.status}`)}
            </Badge>
            {a.status === "PENDING" && a.taskId && task?.makerId === actor.userId && <WithdrawButton taskId={a.taskId} />}
            {canDecide && (
              <LinkButton href={`/approvals/${task!.id}`} variant="primary" icon={<Inbox className="size-4" aria-hidden="true" />}>
                {t("leave.application.openTask")}
              </LinkButton>
            )}
            {canCancel && <CancelLeaveButton id={a.id} />}
          </div>
        }
      />
      <Card>
        <CardHeader title={t("leave.application.title")} icon={<FileText className="size-4.5" aria-hidden="true" />} />
        <CardBody>
          <DescriptionList
            items={[
              { label: t("leave.application.dates"), value: `${dates}${a.halfDay ? ` · ${t("leave.halfDay")}` : ""}` },
              { label: t("leave.application.days"), value: fmt(Number(a.days)) },
              { label: t("leave.application.debit"), value: `${a.debitCode} · ${fmt(Number(a.debitDays))}` },
              { label: t("leave.reason"), value: a.reason },
              { label: t("leave.contact"), value: a.contact ?? "—" },
              { label: t("leave.application.appliedOn"), value: formatDateTime(a.createdAt, locale) },
              ...(a.onBehalf ? [{ label: t("leave.application.sanction"), value: `${a.sanctionRef ?? "—"} · ${t("leave.application.enteredByHr")}` }] : []),
              ...(task?.decidedAt ? [{ label: t("leave.application.decision"), value: `${task.deciderName ?? ""} · ${formatDateTime(task.decidedAt, locale)}${task.decisionNote ? ` · ${task.decisionNote}` : ""}` }] : []),
              ...(a.cancelledAt ? [{ label: t("leave.status.CANCELLED"), value: `${formatDateTime(a.cancelledAt, locale)} · ${a.cancelNote ?? ""}` }] : []),
              ...(a.attachmentKey
                ? [
                    {
                      label: t("leave.application.certificate"),
                      value: (
                        <a href={`/api/v1/leave/applications/${a.id}/attachment`} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
                          <FileText className="size-4" aria-hidden="true" /> {t("leave.application.openCertificate")}
                        </a>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title={t("leave.balances")}
          icon={<ScrollText className="size-4.5" aria-hidden="true" />}
          actions={
            <LinkButton href={own ? "/leave/ledger/me" : `/leave/ledger/${e.id}`} size="sm">
              {t("leave.account")}
            </LinkButton>
          }
        />
        <CardBody>
          <BalanceCards balances={balances.filter((b) => b.creditMode === "HALF_YEARLY" || b.creditMode === "YEARLY")} t={t} locale={locale} compact />
        </CardBody>
      </Card>
    </div>
  );
}
