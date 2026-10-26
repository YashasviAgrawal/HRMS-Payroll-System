import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { myRequests } from "@/modules/employees/records";
import { WithdrawButton } from "../../employees/_components/widgets";
import { NewRequest } from "./new-request";

export const metadata: Metadata = { title: "My requests" };

const TONE: Record<string, Tone> = { PENDING: "amber", APPROVED: "green", REJECTED: "red", RETURNED: "blue", CANCELLED: "gray" };
const LABEL: Record<string, string> = { PENDING: "approvals.pending", APPROVED: "approvals.approved", REJECTED: "approvals.rejected", RETURNED: "approvals.returned", CANCELLED: "common.inactive" };

export default async function MyRequestsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const actor = await requireActor();
  if (!actor.employeeId || !actor.isEmployee) return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const requests = await myRequests(actor);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={t("my.requestsTitle")} description={t("my.requestsSubtitle")} />
      <NewRequest employeeId={actor.employeeId} startOpen={sp.new === "1"} />
      <Card>
        <CardHeader title={t("my.requestsTitle")} />
        {requests.length === 0 ? (
          <EmptyState icon={<Inbox className="size-6" aria-hidden="true" />} title={t("my.empty")} />
        ) : (
          <ul className="divide-y divide-ink-100">
            {requests.map((r) => {
              const kind = (r.payload as { kind?: string }).kind ?? "address";
              const status = r.child ? r.child.status : r.status;
              const waitingChecker = r.status === "APPROVED" && r.child?.status === "PENDING";
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
                  <div>
                    <p className="font-medium text-ink-900">{tDynamic(t, `my.kind.${kind}`)}</p>
                    <p className="text-xs text-ink-500">{formatDateTime(r.createdAt, locale)}</p>
                    {(r.child?.decisionNote ?? r.decisionNote) && <p className="mt-1 text-sm text-ink-600">“{r.child?.decisionNote ?? r.decisionNote}”</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={waitingChecker ? "amber" : TONE[status]} dot>
                      {waitingChecker ? t("my.hrApprovedWaitingChecker") : tDynamic(t, LABEL[status])}
                    </Badge>
                    {r.status === "PENDING" && <WithdrawButton taskId={r.id} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
