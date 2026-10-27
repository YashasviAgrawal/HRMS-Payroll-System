import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Calculator, ClipboardCheck, FileDown, Landmark, PencilLine, Send } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Stepper } from "@/components/ui/stepper";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDate, formatMonth } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { getCase } from "@/modules/pension/cases";
import { PENSION_TYPE_LABEL, restorationDate } from "@/modules/pension/rules";
import { STATUS_TONE } from "@/modules/payroll/present";
import { CASE_TONE } from "../../_components/pension-tabs";
import { CaseForm } from "../case-form";
import { BenefitsButton, NoDuesButtons, SubmitCase } from "./case-actions";

export const metadata: Metadata = { title: "Pension case" };

const STEP = { DRAFT: 0, REJECTED: 0, CHECKING: 1, APPROVING: 2, APPROVED: 3 } as const;

/** S-62: the case — what the records gave, the working, the no-dues checklist, approval, the PPO and the benefits bill. */
export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "pension", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const hi = locale === "hi";
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const d = await getCase(actor, id);
  const w = d.working;
  const c = d.case;
  const editing = sp.edit === "1" && d.can.edit;
  const ready = d.noDues.every((n) => n.status !== "PENDING");
  const restored = w.commutation.from ? restorationDate(w.commutation.from) : null;
  const steps = [t("pension.case.steps.prepare"), t("pension.case.steps.check"), t("pension.case.steps.approve"), t("pension.case.steps.pay")];
  const name = hi && d.employee.nameHi ? d.employee.nameHi : d.employee.name;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: t("pension.title"), href: "/pension" }, { label: t("pension.tabs.cases"), href: "/pension/cases" }, { label: name }]}
        title={name}
        description={`${d.employee.code ?? ""} · ${PENSION_TYPE_LABEL[c.type]?.[hi ? 1 : 0]} · ${t(c.type === "FAMILY" ? "pension.case.diedOn" : "pension.case.lastDayOn", { date: formatDate(c.lastDay, locale) })}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={CASE_TONE[c.status as keyof typeof CASE_TONE]} dot>
              {tDynamic(t, `pension.cases.status.${c.status}`)}
            </Badge>
            {d.can.edit && !editing && (
              <LinkButton href={`/pension/cases/${c.id}?edit=1`} variant="secondary" icon={<PencilLine className="size-4" />}>
                {t("pension.case.change")}
              </LinkButton>
            )}
            {c.status === "APPROVED" && (
              <a href={`/api/v1/pension/cases/${c.id}/ppo`} target="_blank" rel="noopener" className={buttonClass("primary")}>
                <FileDown className="size-4" aria-hidden="true" /> {t("pension.case.ppo")}
              </a>
            )}
          </div>
        }
      />

      <Card className="mb-5">
        <CardBody className="py-4">
          <Stepper steps={steps} current={c.status === "APPROVED" && d.benefits ? 3 : STEP[c.status as keyof typeof STEP]} label={t("pension.tabs.cases")} />
        </CardBody>
      </Card>

      {d.lastReturn && c.status === "DRAFT" && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{t("payroll.returned", { name: d.lastReturn.by ?? "", note: d.lastReturn.note ?? "" })}</p>
        </div>
      )}

      {editing && (
        <Card className="mb-5">
          <CardHeader title={t("pension.case.change")} description={t("pension.case.changeHelp")} />
          <CardBody>
            <CaseForm
              caseId={c.id}
              people={[{ id: d.employee.id, label: `${name} (${d.employee.code ?? "—"})`, scheme: d.employee.type === "PERMANENT_OPS" ? "OPS" : "NPS", status: d.employee.status, dateOfRetirement: d.employee.dateOfRetirement, exitDate: null, bankLast4: d.employee.bankLast4, family: d.family }]}
              initial={{ employeeId: d.employee.id, type: c.type, lastDay: c.lastDay, commutationPct: String(d.inputs.commutationPct), nonQualifyingDays: d.inputs.nonQualifyingDays === null ? "" : String(d.inputs.nonQualifyingDays), familyMemberId: d.inputs.familyMember?.id ?? "", mobile: d.inputs.mobile ?? "", fmaEligible: d.inputs.fmaEligible, note: d.inputs.note ?? "", bankLast4: d.inputs.bank?.last4 ?? d.employee.bankLast4 }}
            />
          </CardBody>
        </Card>
      )}

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="case-tiles">
        {w.pension.amount > 0 ? (
          <StatTile label={t("pension.case.pension")} value={formatINR(w.pension.amount)} icon={<Landmark className="size-5" aria-hidden="true" />} hint={t("pension.case.from", { date: formatDate(w.pensionFrom, locale) })} />
        ) : (
          <StatTile label={t("pension.case.familyPension")} value={w.familyPension.enhanced ? formatINR(w.familyPension.enhanced) : "—"} icon={<Landmark className="size-5" aria-hidden="true" />} hint={w.familyPension.enhanced ? t("pension.case.from", { date: formatDate(w.pensionFrom, locale) }) : t("pension.case.noPension")} />
        )}
        <StatTile label={t("pension.case.gratuity")} value={formatINR(w.gratuity.amount)} tone="blue" icon={<Calculator className="size-5" aria-hidden="true" />} hint={tDynamic(t, `pension.case.gratuityKind.${w.gratuity.kind}`)} />
        <StatTile label={t("pension.case.commutedValue")} value={formatINR(w.commutation.lumpSum)} tone="gray" icon={<Calculator className="size-5" aria-hidden="true" />} hint={w.commutation.monthly ? t("pension.case.commutedHint", { pct: w.commutation.pct, monthly: formatINR(w.commutation.monthly) }) : undefined} />
        <StatTile label={t("pension.case.lumpSum")} value={formatINR(w.lumpSum - w.dues.total)} tone="green" icon={<Calculator className="size-5" aria-hidden="true" />} hint={w.dues.total ? t("pension.case.lessDues", { amount: formatINR(w.dues.total) }) : t("pension.case.lumpHint")} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card data-testid="case-working">
          <CardHeader title={t("pension.case.working")} description={t("pension.case.workingHelp")} icon={<Calculator className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                { label: t("pension.case.qs"), value: t("pension.case.qsValue", { years: w.qs.years, months: w.qs.months, days: w.qs.days, half: w.qs.halfYears }) },
                { label: t("pension.case.nonQualifying"), value: t("pension.case.nonQualifyingValue", { days: d.inputs.nonQualifyingDays ?? Math.round(w.sources.eolDays + w.sources.diesNonDays), eol: w.sources.eolDays, dn: w.sources.diesNonDays }) },
                { label: t("pension.case.lastPay"), value: `${formatINR(w.emoluments.last)}${w.sources.npa ? ` (${t("pension.case.basicNpa", { basic: formatINR(w.sources.basic), npa: formatINR(w.sources.npa) })})` : ""}` },
                { label: t("pension.case.average"), value: formatINR(w.emoluments.average) },
                { label: t("pension.case.used"), value: `${formatINR(w.emoluments.used)} — ${tDynamic(t, `pension.case.which.${w.emoluments.which}`)}` },
                ...(w.sources.scheme === "OPS"
                  ? [
                      { label: t("pension.case.pensionCalc"), value: w.pension.eligible ? t("pension.case.pensionValue", { used: formatINR(w.emoluments.used), share: Math.round(w.pension.share * 100), amount: formatINR(w.pension.amount) }) : t("pension.case.notEligible") },
                      ...(w.commutation.monthly
                        ? [{ label: t("pension.case.commutation"), value: t("pension.case.commutationValue", { monthly: formatINR(w.commutation.monthly), age: w.commutation.ageNextBirthday, factor: w.commutation.factor, lump: formatINR(w.commutation.lumpSum), reduced: formatINR(w.commutation.reducedPension), restored: formatDate(restored, locale) }) }]
                        : []),
                    ]
                  : [{ label: t("pension.case.pensionCalc"), value: t("pension.case.npsNote") }]),
                { label: t("pension.case.withDa"), value: t("pension.case.withDaValue", { amount: formatINR(w.emoluments.withDa), da: w.sources.daPercent }) },
                { label: t("pension.case.gratuity"), value: `${formatINR(w.gratuity.amount)} — ${tDynamic(t, `pension.case.gratuityKind.${w.gratuity.kind}`)}` },
                { label: t("pension.case.encashment"), value: t("pension.case.encashmentValue", { days: w.leaveEncashment.days, amount: formatINR(w.leaveEncashment.amount) }) },
                ...(w.sources.scheme === "OPS" ? [{ label: t("pension.case.gpf"), value: t("pension.case.gpfValue", { total: formatINR(w.gpf), balance: formatINR(w.sources.gpf.balance), interest: formatINR(w.sources.gpf.interest) }) }] : []),
                ...(w.familyPension.enhanced ? [{ label: t("pension.case.familyPension"), value: t("pension.case.familyValue", { enhanced: formatINR(w.familyPension.enhanced), until: formatDate(w.familyPension.enhancedUntil, locale), normal: formatINR(w.familyPension.normal) }) }] : []),
                ...(w.dues.total ? [{ label: t("pension.case.duesTotal"), value: t("pension.case.duesValue", { noDues: formatINR(w.dues.noDues), salary: formatINR(w.dues.salaryOverpaid) }) }] : []),
              ]}
            />
          </CardBody>
        </Card>

        <div className="grid content-start gap-5">
          <Card>
            <CardHeader title={t("pension.case.tenMonths")} description={t("pension.case.tenMonthsHelp")} />
            <Table>
              <THead>
                <tr>
                  <Th>{t("payroll.month")}</Th>
                  <Th align="right">{t("pension.case.pay")}</Th>
                </tr>
              </THead>
              <tbody>
                {w.sources.tenMonths.map((m) => (
                  <Tr key={m.month}>
                    <Td>
                      {formatMonth(m.month, locale)}
                      {!m.fromBill && <span className="ml-2 text-xs text-ink-500">{t("pension.case.assumed")}</span>}
                    </Td>
                    <Td align="right">{formatINR(m.pay)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card>
            <CardHeader title={t("pension.case.inputs")} />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  ...(d.inputs.familyMember ? [{ label: t("pension.death.familyFor"), value: `${d.inputs.familyMember.name} (${tDynamic(t, `pension.relation.${d.inputs.familyMember.relation}`)})` }] : []),
                  { label: t("pension.fields.account"), value: d.inputs.bank ? `••••${d.inputs.bank.last4} · ${d.inputs.bank.ifsc}` : d.employee.bankLast4 ? t("pension.case.accountKept", { last4: d.employee.bankLast4 }) : "—" },
                  { label: t("pension.fields.mobile"), value: d.inputs.mobile ?? "—" },
                  { label: t("pension.fields.fma"), value: d.inputs.fmaEligible ? t("common.yes") : t("common.no") },
                  ...(d.inputs.note ? [{ label: t("pension.case.note"), value: d.inputs.note }] : []),
                  { label: t("pension.case.preparedBy"), value: d.case.createdByName },
                ]}
              />
            </CardBody>
          </Card>
        </div>
      </div>

      <Card className="mt-5" data-testid="no-dues">
        <CardHeader title={t("pension.case.noDuesTitle")} description={t("pension.case.noDuesHelp")} icon={<ClipboardCheck className="size-4.5" aria-hidden="true" />} actions={<Badge tone={ready ? "green" : "amber"}>{`${d.noDues.filter((n) => n.status !== "PENDING").length} / ${d.noDues.length}`}</Badge>} />
        <Table stack>
          <THead>
            <tr>
              <Th>{t("payroll.columns.section")}</Th>
              <Th>{t("payroll.columns.status")}</Th>
              <Th align="right">{t("pension.case.duesAmount")}</Th>
              <Th>{d.can.edit ? t("pension.case.answer") : t("pension.case.by")}</Th>
            </tr>
          </THead>
          <tbody>
            {d.noDues.map((n) => (
              <Tr key={n.sectionId}>
                <Td className="font-medium text-ink-900">
                  {hi ? n.nameHi : n.name}
                  {n.note && <span className="block text-xs font-normal text-ink-500">{n.note}</span>}
                </Td>
                <Td label={t("payroll.columns.status")}>
                  <Badge tone={n.status === "CLEAR" ? "green" : n.status === "DUES" ? "red" : "gray"}>{tDynamic(t, `pension.case.noDuesStatus.${n.status}`)}</Badge>
                </Td>
                <Td label={t("pension.case.duesAmount")} align="right">
                  {n.amount ? formatINR(n.amount) : "—"}
                </Td>
                <Td label={d.can.edit ? t("pension.case.answer") : t("pension.case.by")}>{d.can.edit ? <NoDuesButtons caseId={c.id} sectionId={n.sectionId} section={hi ? n.nameHi : n.name} /> : <span className="text-sm text-ink-500">{n.byName ?? "—"}</span>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-5">
        <CardHeader title={t("pension.case.approval")} icon={<Send className="size-4.5" aria-hidden="true" />} />
        <CardBody className="space-y-3 text-sm">
          {d.can.submit && <SubmitCase caseId={c.id} ready={ready} />}
          {d.task && (
            <p className="text-ink-700">
              {t(d.task.step === "approver" ? "pension.case.withApprover" : "pension.case.withChecker")}{" "}
              {d.task.canOpen && (
                <Link href={`/approvals/${d.task.id}`} className="font-medium text-brand-700 hover:underline">
                  {t("pension.case.openTask")}
                </Link>
              )}
            </p>
          )}
          {c.status === "APPROVED" && (
            <div className="space-y-3">
              <p className="text-brand-800">{t("pension.case.approvedLine", { ppo: c.ppoNumber ?? "—", date: c.approvedAt ? formatDate(new Date(c.approvedAt).toISOString().slice(0, 10), locale) : "" })}</p>
              {c.pensionerId && (
                <p>
                  <Link href={`/pension/pensioners/${c.pensionerId}`} className="font-medium text-brand-700 hover:underline">
                    {t("pension.case.openPensioner")}
                  </Link>
                </p>
              )}
              {d.benefits ? (
                <p className="flex flex-wrap items-center gap-2">
                  <Link href={`/pension/bills/${d.benefits.id}`} className="font-medium text-brand-700 hover:underline">
                    {t("pension.case.benefitsBill", { amount: formatINR(d.benefits.net) })}
                  </Link>
                  <Badge tone={STATUS_TONE[d.benefits.status]}>{tDynamic(t, `payroll.status.${d.benefits.status}`)}</Badge>
                </p>
              ) : (
                d.can.benefits && <BenefitsButton caseId={c.id} />
              )}
            </div>
          )}
          {c.status === "REJECTED" && <p className="text-red-700">{t("pension.case.rejectedLine")}</p>}
        </CardBody>
      </Card>
    </div>
  );
}
