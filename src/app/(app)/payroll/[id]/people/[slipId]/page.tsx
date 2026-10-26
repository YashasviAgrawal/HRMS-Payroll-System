import type { Metadata } from "next";
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
          { label: `${formatMonth(s.run.month, locale)} — ${tDynamic(t, `payroll.groups.${s.run.payGroup}`)}`, href: `/payroll/${s.run.id}?tab=people` },
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
              { label: t("payroll.lastNet"), value: s.lastNet === null ? "—" : `${formatINR(s.lastNet)}${s.changePct !== null ? ` (${signedPct(s.changePct)}%)` : ""}` },
              { label: t("payroll.slip.payLevel"), value: s.payLevel ? t("payroll.slip.levelCell", { level: s.payLevel, cell: s.payCell ?? "—" }) : "—" },
              { label: t("payroll.slip.bank"), value: s.bankLast4 ? `••••${s.bankLast4}` : "—" },
              { label: t("payroll.slip.daysInMonth"), value: s.daysInMonth },
              { label: t("payroll.slip.daysOnRoll"), value: s.daysOnRoll },
              { label: t("payroll.slip.lossDays"), value: s.lossDays },
              { label: t("payroll.slip.halfPayDays"), value: s.halfPayDays },
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
