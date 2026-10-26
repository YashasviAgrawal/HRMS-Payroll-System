import type { Metadata } from "next";
import { ArrowUpRight, ClipboardCheck, UserRound } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { canAll, scopeFor } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDate, toISODate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { basicPay } from "@/modules/payroll/matrix-7cpc";
import { maskedIds } from "@/modules/employees/present";
import { CHECKLIST_ITEMS } from "@/modules/recruitment/schema";
import { getJoining } from "@/modules/recruitment/service";
import { ChecklistPanel, JoiningActions } from "./joining-client";

export const metadata: Metadata = { title: "Joining" };

export default async function JoiningPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (!scopeFor(actor, "recruitment", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const { id } = await params;
  const j = await getJoining(actor, id);
  const e = j.employee;
  const masked = maskedIds(e);
  const editable = j.status === "IN_PROGRESS" && canAll(actor, "employee_master", "create");
  const done = CHECKLIST_ITEMS.filter((k) => j.checklist[k].done).length;
  const name = [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" ");
  const tone = { IN_PROGRESS: "blue", SUBMITTED: "amber", COMPLETED: "green", CANCELLED: "gray" } as const;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: t("recruitment.title"), href: "/recruitment?tab=joining" }, { label: name }]}
        title={locale === "hi" && e.nameHi ? e.nameHi : name}
        description={`${locale === "hi" ? e.post.nameHi : e.post.name} · ${locale === "hi" ? e.section.nameHi : e.section.name}${j.applicant?.appointmentLetterNo ? ` · ${j.applicant.appointmentLetterNo}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={tone[j.status]} dot>
              {tDynamic(t, `recruitment.joining.status.${j.status}`)}
            </Badge>
            {editable && <JoiningActions joiningId={j.id} ready={done === CHECKLIST_ITEMS.length} />}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader
            title={t("recruitment.joining.checklist")}
            description={t("recruitment.joining.progress", { done, total: CHECKLIST_ITEMS.length })}
            icon={<ClipboardCheck className="size-4.5" aria-hidden="true" />}
          />
          <ChecklistPanel
            joiningId={j.id}
            employeeId={e.id}
            editable={editable}
            checklist={j.checklist}
            documents={j.documents.map((d) => ({ id: d.id, title: d.title }))}
          />
        </Card>
        <Card>
          <CardHeader
            title={e.employeeCode ? t("recruitment.joining.recordDone") : t("recruitment.joining.record")}
            description={e.employeeCode ? t("recruitment.joining.recordDoneHint", { code: e.employeeCode }) : t("recruitment.joining.recordHint")}
            icon={<UserRound className="size-4.5" aria-hidden="true" />}
            actions={
              <LinkButton href={`/employees/${e.id}`} size="sm" icon={<ArrowUpRight className="size-4" aria-hidden="true" />}>
                {t("recruitment.joining.openRecord")}
              </LinkButton>
            }
          />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                { label: t("employees.fields.type"), value: tDynamic(t, `employees.type.${e.type}`) },
                { label: t("employees.fields.dateOfJoining"), value: formatDate(toISODate(e.dateOfJoining), locale) },
                {
                  label: t("recruitment.joining.initialPay"),
                  value: e.payLevel ? `${t("employees.level", { level: e.payLevel })} · ${t("employees.fields.payCell")} ${e.payCell} · ${formatINR(basicPay(e.payLevel, e.payCell))}` : `${formatINR(Number(e.wageRate ?? 0))} ${e.wageBasis === "DAILY" ? t("employees.wageBasis.DAILY") : t("employees.wageBasis.MONTHLY")}`,
                },
                { label: t("employees.fields.pan"), value: masked.pan ?? <span className="text-red-600">{t("employees.profile.noValue")}</span> },
                { label: t("employees.fields.aadhaar"), value: masked.aadhaar ?? <span className="text-red-600">{t("employees.profile.noValue")}</span> },
                { label: t("employees.fields.bankAccount"), value: masked.bankAccount ? `${masked.bankAccount} · ${e.ifsc ?? ""}` : <span className="text-red-600">{t("employees.profile.noValue")}</span> },
              ]}
            />
            {editable && (
              <div className="mt-5 flex flex-wrap gap-2">
                <LinkButton href={`/employees/${e.id}/edit?tab=personal`} size="sm" variant="subtle">
                  {t("employees.tabs.personal")}
                </LinkButton>
                <LinkButton href={`/employees/${e.id}/edit?tab=job`} size="sm" variant="subtle">
                  {t("employees.tabs.job")}
                </LinkButton>
                <LinkButton href={`/employees/${e.id}/edit?tab=ids`} size="sm" variant="subtle">
                  {t("employees.tabs.ids")}
                </LinkButton>
                <LinkButton href={`/employees/${e.id}/edit?tab=family`} size="sm" variant="subtle">
                  {t("employees.tabs.family")}
                </LinkButton>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
