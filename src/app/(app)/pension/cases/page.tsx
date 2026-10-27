import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, FileSignature, Plus } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink } from "@/components/ui/row-link";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { caseCandidates, casesOverview } from "@/modules/pension/cases";
import { PENSION_TYPE_LABEL } from "@/modules/pension/rules";
import { CASE_TONE, PensionTabs } from "../_components/pension-tabs";
import { EmployeeDeathButton } from "./employee-death-button";

export const metadata: Metadata = { title: "Pension cases" };

const STAGE_TONE = { TWELVE: "blue", SIX: "amber", RETIRED: "red" } as const;

/** PN-07, S-62: retirements ahead (alerts at 12 and 6 months), people retired without a case, and every case. */
export default async function CasesPage() {
  const actor = await requireActor();
  if (!canAll(actor, "pension", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const hi = locale === "hi";
  const data = await casesOverview(actor);
  const candidates = data.canManage ? await caseCandidates(actor) : [];

  return (
    <div>
      <PageHeader
        title={t("pension.title")}
        description={t("pension.cases.subtitle")}
        actions={
          data.canManage && (
            <div className="flex flex-wrap gap-2">
              <EmployeeDeathButton people={candidates.filter((c) => c.status === "ACTIVE" || c.status === "SUSPENDED").map((c) => ({ id: c.id, label: `${hi && c.nameHi ? c.nameHi : c.name} (${c.code ?? "—"})`, family: c.family }))} />
              <LinkButton href="/pension/cases/new" variant="primary" icon={<Plus className="size-4" />}>
                {t("pension.cases.start")}
              </LinkButton>
            </div>
          )
        }
      />
      <PensionTabs active="cases" t={t} />

      <Card className="mb-6" data-testid="retirement-alerts">
        <CardHeader title={t("pension.cases.alerts")} description={t("pension.cases.alertsHelp")} icon={<BellRing className="size-4.5" aria-hidden="true" />} />
        {data.alerts.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("pension.cases.noAlerts")}</p>
          </CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("pension.cases.employee")}</Th>
                <Th>{t("pension.cases.lastDay")}</Th>
                <Th>{t("pension.cases.alert")}</Th>
                <Th>{t("pension.cases.case")}</Th>
                <Th>{t("pension.cases.noDues")}</Th>
              </tr>
            </THead>
            <tbody>
              {data.alerts.map((a) => (
                <Tr key={a.employeeId}>
                  <Td>
                    <span className="font-medium text-ink-900">{hi && a.nameHi ? a.nameHi : a.name}</span>
                    <span className="block text-xs text-ink-500">
                      {a.code} · {hi ? a.post.nameHi : a.post.name} · {hi ? a.section.nameHi : a.section.name} · {a.scheme}
                    </span>
                  </Td>
                  <Td label={t("pension.cases.lastDay")}>
                    {formatDate(a.lastDay, locale)}
                    <span className="block text-xs text-ink-500">{a.daysLeft >= 0 ? t("pension.cases.daysLeft", { days: a.daysLeft }) : t("pension.cases.daysAgo", { days: -a.daysLeft })}</span>
                  </Td>
                  <Td label={t("pension.cases.alert")}>
                    <Badge tone={STAGE_TONE[a.stage]} dot>
                      {tDynamic(t, `pension.cases.stage.${a.stage}`)}
                    </Badge>
                  </Td>
                  <Td label={t("pension.cases.case")}>
                    {a.case ? (
                      <Link href={`/pension/cases/${a.case.id}`} className="inline-flex items-center gap-2 font-medium text-brand-700 hover:underline">
                        <Badge tone={CASE_TONE[a.case.status as keyof typeof CASE_TONE]}>{tDynamic(t, `pension.cases.status.${a.case.status}`)}</Badge>
                      </Link>
                    ) : data.canManage && !a.isSelf ? (
                      <Link href={`/pension/cases/new?employee=${a.employeeId}`} className="text-sm font-medium text-brand-700 hover:underline">
                        {t("pension.cases.startFor")}
                      </Link>
                    ) : (
                      <span className="text-sm text-ink-500">{t("pension.cases.none")}</span>
                    )}
                  </Td>
                  <Td label={t("pension.cases.noDues")}>{a.case ? `${a.case.noDuesDone} / ${a.case.noDuesTotal}` : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title={t("pension.cases.all")} icon={<FileSignature className="size-4.5" aria-hidden="true" />} />
        {data.cases.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("pension.cases.noCases")}</p>
          </CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("pension.cases.employee")}</Th>
                <Th>{t("pension.pensioners.kind")}</Th>
                <Th align="right">{t("pension.cases.pension")}</Th>
                <Th align="right">{t("pension.cases.lumpSum")}</Th>
                <Th>{t("payroll.columns.status")}</Th>
              </tr>
            </THead>
            <tbody>
              {data.cases.map((c) => (
                <RowLink key={c.id} href={`/pension/cases/${c.id}`}>
                  <Td>
                    <Link href={`/pension/cases/${c.id}`} className="font-medium text-ink-900 hover:text-brand-700">
                      {hi && c.nameHi ? c.nameHi : c.name}
                    </Link>
                    <span className="block text-xs text-ink-500">
                      {c.code} · {t("pension.cases.lastDayShort", { date: formatDate(c.lastDay, locale) })}
                      {c.ppoNumber && ` · ${c.ppoNumber}`}
                    </span>
                  </Td>
                  <Td label={t("pension.pensioners.kind")}>{PENSION_TYPE_LABEL[c.type]?.[hi ? 1 : 0]}</Td>
                  <Td label={t("pension.cases.pension")} align="right">
                    {c.pension ? formatINR(c.pension) : c.familyPension ? t("pension.cases.familyShort", { amount: formatINR(c.familyPension) }) : "—"}
                  </Td>
                  <Td label={t("pension.cases.lumpSum")} align="right" className="font-semibold text-ink-950">
                    {formatINR(c.lumpSum)}
                  </Td>
                  <Td label={t("payroll.columns.status")}>
                    <Badge tone={CASE_TONE[c.status as keyof typeof CASE_TONE]}>{tDynamic(t, `pension.cases.status.${c.status}`)}</Badge>
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
