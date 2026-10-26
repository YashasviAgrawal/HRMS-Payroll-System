import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { payslipRuns } from "@/modules/payroll/payslips";
import { PayrollTabs } from "../_components/payroll-tabs";
import { BulkDownload, SendNotices } from "./payslip-actions";

export const metadata: Metadata = { title: "Payslips" };

/** S-44 for HR & Accounts: payslips per bill — download a section as one PDF (SL-05), see and send notices (SL-04). */
export default async function PayslipsPage() {
  const actor = await requireActor();
  if (!canAll(actor, "payroll", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const data = await payslipRuns(actor);
  const sections = data.sections.map((s) => ({ id: s.id, label: locale === "hi" ? s.nameHi : s.name }));

  return (
    <div>
      <PageHeader title={t("payroll.title")} description={t("payroll.payslips.subtitle")} />
      <PayrollTabs active="payslips" principal={actor} t={t} />
      {data.runs.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-600">{t("payroll.payslips.none")}</p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-4">
          {data.runs.map((r) => (
            <Card key={r.id}>
              <CardHeader
                title={locale === "hi" ? r.titleHi : r.title}
                description={r.released ? t("payroll.payslips.sentCount", { sent: r.sent, people: r.people }) : t("payroll.payslips.notReleased")}
                icon={<Receipt className="size-4.5" aria-hidden="true" />}
                actions={<Badge tone={r.released ? (r.sent === r.people ? "green" : "amber") : "gray"}>{r.released ? (r.sent === r.people ? t("payroll.payslips.allSent") : t("payroll.payslips.someWaiting")) : t("payroll.status.APPROVED")}</Badge>}
              />
              <CardBody className="flex flex-wrap items-end justify-between gap-3">
                <BulkDownload runId={r.id} sections={sections} />
                {data.canSend && r.released && r.sent < r.people && <SendNotices runId={r.id} />}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
