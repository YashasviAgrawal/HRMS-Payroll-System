import type { Metadata } from "next";
import Link from "next/link";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDate, formatMonth } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { getLoan } from "@/modules/payroll/loans";
import { LOAN_TONE } from "../tones";

export const metadata: Metadata = { title: "Loan" };

/** One loan: terms, what is left, the schedule and every recovery through payroll. */
export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "arrears_loans", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const { id } = await params;
  const { loan, recoveries, schedule, position } = await getLoan(actor, id);
  const recovered = recoveries.reduce((s, r) => s + r.principal + r.interest, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        breadcrumbs={[{ label: t("payroll.tabs.loans"), href: "/payroll/loans" }, { label: loan.code }]}
        title={`${tDynamic(t, `payroll.loans.types.${loan.type}`)} — ${locale === "hi" && loan.nameHi ? loan.nameHi : loan.name}`}
        description={`${loan.code} · ${loan.orderNumber ?? ""} · ${formatDate(loan.sanctionDate, locale)}`}
        actions={<Badge tone={LOAN_TONE[loan.status]}>{tDynamic(t, `payroll.loans.status.${loan.status}`)}</Badge>}
      />
      <Card className="mb-5">
        <CardBody>
          <DescriptionList
            columns={3}
            items={[
              { label: t("payroll.loans.amount"), value: formatINR(loan.principal) },
              { label: t("payroll.loans.interestRate"), value: loan.interestRate ? `${loan.interestRate}%` : t("payroll.loans.noInterest") },
              { label: t("payroll.loans.instalment"), value: `${loan.instalments} × ${formatINR(loan.instalmentAmount)}` },
              { label: t("payroll.loans.recovered"), value: formatINR(recovered) },
              { label: t("payroll.loans.principalLeft"), value: <span className="font-semibold text-ink-950">{formatINR(loan.status === "CLOSED" ? 0 : position.principalLeft)}</span> },
              { label: t("payroll.loans.interestSoFar"), value: `${formatINR(position.interestTotal)} · ${t("payroll.loans.interestAll", { amount: formatINR(schedule.reduce((s, r) => s + r.interest, 0)) })}` },
              ...(loan.purpose ? [{ label: t("payroll.loans.purpose"), value: loan.purpose }] : []),
            ]}
          />
        </CardBody>
      </Card>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("payroll.loans.recoveries")} />
          {recoveries.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-600">{t("payroll.loans.noRecoveries")}</p>
            </CardBody>
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>{t("payroll.month")}</Th>
                  <Th align="right">{t("payroll.loans.principal")}</Th>
                  <Th align="right">{t("payroll.loans.interest")}</Th>
                </tr>
              </THead>
              <tbody>
                {recoveries.map((r) => (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap">
                      <Link href={`/payroll/${r.runId}`} className="hover:text-brand-700">
                        {formatMonth(r.month, locale)}
                      </Link>
                    </Td>
                    <Td align="right">{formatINR(r.principal)}</Td>
                    <Td align="right">{formatINR(r.interest)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title={t("payroll.loans.schedule")} description={t("payroll.loans.scheduleHelp")} />
          <div className="scrollbar-thin relative max-h-[28rem] overflow-y-auto">
            <Table>
              <THead>
                <tr>
                  <Th>{t("payroll.month")}</Th>
                  <Th align="right">{t("payroll.loans.principal")}</Th>
                  <Th align="right">{t("payroll.loans.interest")}</Th>
                  <Th align="right">{t("payroll.loans.left")}</Th>
                </tr>
              </THead>
              <tbody>
                {schedule.map((r) => (
                  <Tr key={r.month}>
                    <Td className="whitespace-nowrap">{formatMonth(r.month, locale)}</Td>
                    <Td align="right">{r.principal ? formatINR(r.principal) : ""}</Td>
                    <Td align="right">{r.interest ? formatINR(r.interest) : ""}</Td>
                    <Td align="right" className="text-ink-500">
                      {formatINR(r.principalLeft)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}
