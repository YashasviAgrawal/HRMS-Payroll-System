import type { Metadata } from "next";
import Link from "next/link";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatMonth } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { amountInWords, formatINR } from "@/lib/money";
import type { PayLine } from "@/modules/payroll/engine";
import { signedPct } from "@/modules/payroll/present";
import { getPayslip } from "@/modules/payroll/run";

export const metadata: Metadata = { title: "Pay sheet" };

/** One person's pay in a run — what the Checker opens to see how a number was reached. */
export default async function PaySheetPage({ params }: { params: Promise<{ id: string; slipId: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "payroll", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const { id, slipId } = await params;
  const s = await getPayslip(actor, id, slipId);
  const name = locale === "hi" && s.employee.nameHi ? s.employee.nameHi : s.employee.name;
  const lineName = (l: PayLine) => (locale === "hi" ? l.nameHi : l.name);

  const block = (title: string, lines: PayLine[], total?: number) => (
    <Card>
      <CardHeader title={title} />
      {lines.length === 0 ? (
        <CardBody>
          <p className="text-sm text-ink-500">{t("payroll.slip.noLines")}</p>
        </CardBody>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>{t("payroll.columns.head")}</Th>
              <Th align="right">{t("payroll.columns.amount")}</Th>
            </tr>
          </THead>
          <tbody>
            {lines.map((l) => (
              <Tr key={l.code}>
                <Td>
                  <span className="font-medium text-ink-900">{lineName(l)}</span>
                  <span className="block text-xs text-ink-500">{l.accountHead}</span>
                </Td>
                <Td align="right">{formatINR(l.amount)}</Td>
              </Tr>
            ))}
            {total !== undefined && (
              <Tr className="bg-brand-50/50 font-semibold">
                <Td>{t("common.total")}</Td>
                <Td align="right">{formatINR(total)}</Td>
              </Tr>
            )}
          </tbody>
        </Table>
      )}
    </Card>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        breadcrumbs={[
          { label: t("payroll.title"), href: `/payroll?month=${s.run.month}` },
          { label: s.run.kind === "SUPPLEMENTARY" ? (locale === "hi" ? s.run.titleHi : s.run.title) : `${formatMonth(s.run.month, locale)} — ${tDynamic(t, `payroll.groups.${s.run.payGroup}`)}`, href: `/payroll/${s.run.id}?tab=people` },
          { label: s.employee.employeeCode ?? "" },
        ]}
        title={name}
        description={`${s.employee.employeeCode} · ${locale === "hi" ? s.employee.post.nameHi : s.employee.post.name} · ${locale === "hi" ? s.employee.section.nameHi : s.employee.section.name}`}
        actions={s.status === "WITHHELD" ? <Badge tone="amber">{t("payroll.withheld")}</Badge> : s.creditStatus ? <Badge tone={s.creditStatus === "FAILED" ? "red" : "green"}>{tDynamic(t, `payroll.credit.${s.creditStatus}`)}</Badge> : undefined}
      />

      <Card className="mb-5">
        <CardBody>
          <DescriptionList
            columns={3}
            items={[
              { label: t("payroll.net"), value: <span className="tabular text-xl font-semibold text-ink-950">{formatINR(s.net)}</span> },
              ...(s.run.kind === "SUPPLEMENTARY" ? [] : [{ label: t("payroll.lastNet"), value: s.lastNet === null ? "—" : `${formatINR(s.lastNet)}${s.changePct !== null ? ` (${signedPct(s.changePct)}%)` : ""}` }]),
              { label: t("payroll.slip.payLevel"), value: s.payLevel ? t("payroll.slip.levelCell", { level: s.payLevel, cell: s.payCell ?? "—" }) : "—" },
              { label: t("payroll.slip.bank"), value: s.bankLast4 ? `••••${s.bankLast4}` : "—" },
              // Days do not apply to arrears (they use each month's own days).
              ...(s.detail.arrears
                ? []
                : [
                    { label: t("payroll.slip.daysInMonth"), value: s.daysInMonth },
                    { label: t("payroll.slip.daysOnRoll"), value: s.daysOnRoll },
                    { label: t("payroll.slip.lossDays"), value: s.lossDays },
                    { label: t("payroll.slip.halfPayDays"), value: s.halfPayDays },
                  ]),
              ...(s.workedDays !== null && s.employee.type === "DAILY_WAGE" ? [{ label: t("payroll.slip.workedDays"), value: s.workedDays }] : []),
              { label: t("payroll.slip.inWords"), value: amountInWords(s.net, locale) },
            ]}
          />
          {s.withheldReason && (
            <p className="mt-4 text-sm text-amber-800">
              {t("payroll.withheld")}: {s.withheldReason.split(",").map((c) => tDynamic(t, `payroll.exceptions.codes.${c}`)).join(", ")}
            </p>
          )}
          {s.creditNote && <p className="mt-2 text-sm text-red-700">{s.creditNote}</p>}
        </CardBody>
      </Card>

      {s.detail.arrears && s.detail.arrears.length > 0 && (
        <Card className="mb-5">
          <CardHeader title={t("payroll.slip.arrears")} description={t("payroll.slip.arrearsHelp")} />
          <Table stack>
            <THead>
              <tr>
                <Th>{t("payroll.month")}</Th>
                <Th>{t("payroll.columns.head")}</Th>
                <Th align="right">{t("payroll.slip.due")}</Th>
                <Th align="right">{t("payroll.slip.drawn")}</Th>
                <Th align="right">{t("payroll.slip.arrear")}</Th>
              </tr>
            </THead>
            <tbody>
              {s.detail.arrears.flatMap((m) =>
                m.lines.map((l) => (
                  <Tr key={`${m.month}-${l.code}`}>
                    <Td className="font-medium">{formatMonth(m.month, locale)}</Td>
                    <Td label={t("payroll.columns.head")}>{locale === "hi" ? l.nameHi : l.name}</Td>
                    <Td label={t("payroll.slip.due")} align="right">
                      {formatINR(l.due)}
                    </Td>
                    <Td label={t("payroll.slip.drawn")} align="right">
                      {formatINR(l.drawn)}
                    </Td>
                    <Td label={t("payroll.slip.arrear")} align="right" className="font-semibold text-ink-950">
                      {formatINR(l.diff)}
                    </Td>
                  </Tr>
                )),
              )}
            </tbody>
          </Table>
        </Card>
      )}
      {s.detail.loans && s.detail.loans.length > 0 && (
        <Card className="mb-5">
          <CardBody className="text-sm text-ink-700">
            {t("payroll.slip.loans")}{" "}
            {s.detail.loans.map((l, i) => (
              <span key={l.loanId}>
                {i > 0 && " · "}
                <Link href={`/payroll/loans/${l.loanId}`} className="font-medium text-brand-700 hover:underline">
                  {formatINR(l.principal + l.interest)}
                </Link>
                {l.interest > 0 && ` (${t("payroll.loans.interest")} ${formatINR(l.interest)})`}
              </span>
            ))}
          </CardBody>
        </Card>
      )}

      {s.detail.tax && s.detail.tax.annualTax > 0 && (
        <Card className="mb-5" data-testid="tax-working">
          <CardBody className="space-y-1 text-sm text-ink-700">
            <p className="font-medium text-ink-900">{t("payroll.slip.taxTitle", { fy: s.detail.tax.fy })}</p>
            <p>
              {t("payroll.slip.taxLine", {
                regime: t(`statutory.tax.regimes.${s.detail.tax.regime}`),
                gross: formatINR(s.detail.tax.projectedGross),
                taxable: formatINR(s.detail.tax.taxable),
                tax: formatINR(s.detail.tax.annualTax),
              })}
            </p>
            <p>{t("payroll.slip.taxSpread", { deducted: formatINR(s.detail.tax.deductedSoFar), months: s.detail.tax.monthsLeft, monthly: formatINR(s.detail.tax.monthly) })}</p>
            <p className="text-xs text-ink-500">{t(`statutory.tax.basis.${s.detail.tax.basis}`)}</p>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {block(t("payroll.kinds.EARNING"), s.earnings, s.gross)}
        <div className="grid content-start gap-5">
          {block(t("payroll.kinds.DEDUCTION"), s.deductions, s.totalDeductions)}
          {s.employer.length > 0 && block(t("payroll.kinds.EMPLOYER"), s.employer)}
        </div>
      </div>
    </div>
  );
}
