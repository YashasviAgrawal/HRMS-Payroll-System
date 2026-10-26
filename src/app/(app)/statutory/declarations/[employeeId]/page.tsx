import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileText, Landmark, ScrollText, Scale } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { getDeclaration } from "@/modules/statutory/tax";
import { DEDUCTION_CAPS } from "@/modules/statutory/tax-rules";
import { DECL_TONE } from "../../_components/statutory-tabs";
import { TaxComparison } from "../../_components/tax-comparison";
import { CarryInForm } from "./carry-in-form";

export const metadata: Metadata = { title: "Tax declaration" };

const ITEMS = ["sec80C", "sec80D", "sec80CCD1B", "homeLoanInterest", "rentPaid", "otherIncome"] as const;
const CAP: Partial<Record<(typeof ITEMS)[number], number>> = { sec80C: DEDUCTION_CAPS.sec80C, sec80D: DEDUCTION_CAPS.sec80D, sec80CCD1B: DEDUCTION_CAPS.sec80CCD1B, homeLoanInterest: DEDUCTION_CAPS.homeLoanInterest };

/** S-51: one person's year — what they declared, the proofs, salary carried in, and the tax both ways. */
export default async function DeclarationPage({ params, searchParams }: { params: Promise<{ employeeId: string }>; searchParams: Promise<{ fy?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "statutory", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const d = await getDeclaration(actor, (await params).employeeId, (await searchParams).fy);
  const decl = d.declaration;
  const name = locale === "hi" && d.employee.nameHi ? d.employee.nameHi : d.employee.name;

  return (
    <div className="mx-auto max-w-5xl">
      <Link href={`/statutory/declarations?fy=${d.fy}`} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("statutory.tabs.declarations")}
      </Link>
      <PageHeader
        title={`${name} · ${d.employee.code}`}
        description={`${t("statutory.fy")} ${d.fy}${d.employee.panLast4 ? ` · PAN XXXXXX${d.employee.panLast4}` : ` · ${t("statutory.tax.noPan")}`}`}
        actions={d.taskId && <LinkButton href={`/approvals/${d.taskId}`} variant="primary">{t("statutory.tax.openTask")}</LinkButton>}
      />
      <Card className="mb-5">
        <CardHeader
          title={t("statutory.tabs.declarations")}
          icon={<ScrollText className="size-4.5" aria-hidden="true" />}
          actions={<Badge tone={decl ? DECL_TONE[decl.status as keyof typeof DECL_TONE] : "gray"} dot>{tDynamic(t, `statutory.tax.status.${decl?.status ?? "NONE"}`)}</Badge>}
        />
        {!decl || decl.status === "DRAFT" ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("statutory.tax.noDeclaration", { name, fy: d.fy })}</p>
          </CardBody>
        ) : (
          <>
            <CardBody className="space-y-1 text-sm">
              <p>
                <span className="text-ink-600">{t("statutory.tax.regime")}: </span>
                <span className="font-semibold text-ink-900">{tDynamic(t, `statutory.tax.regimes.${decl.regime}`)}</span>
              </p>
              {decl.submittedAt && <p className="text-ink-600">{t("statutory.tax.submittedOn", { date: formatDate(decl.submittedAt.slice(0, 10), locale) })}</p>}
              {decl.verifiedAt && <p className="text-ink-600">{t("statutory.tax.verifiedOn", { date: formatDate(decl.verifiedAt.slice(0, 10), locale) })}</p>}
              {decl.status === "RETURNED" && decl.remarks && <p className="font-medium text-red-700">{t("statutory.tax.returnedNote", { note: decl.remarks })}</p>}
            </CardBody>
            {decl.regime === "OLD" && (
              <Table stack>
                <THead>
                  <tr>
                    <Th>{t("statutory.tax.declared")}</Th>
                    <Th align="right">{t("statutory.amount")}</Th>
                  </tr>
                </THead>
                <tbody>
                  {ITEMS.map((k) => (
                    <Tr key={k}>
                      <Td>
                        {t(`statutory.tax.items.${k}`)}
                        {CAP[k] && <span className="block text-xs text-ink-500">{t("statutory.tax.cap", { amount: formatINR(CAP[k]!) })}</span>}
                      </Td>
                      <Td label={t("statutory.amount")} align="right" className="font-medium text-ink-900">
                        {formatINR(decl.items[k])}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </>
        )}
      </Card>

      {decl && decl.proofs.length > 0 && (
        <Card className="mb-5">
          <CardHeader title={t("statutory.tax.proofs")} icon={<FileText className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <ul className="divide-y divide-ink-100">
              {decl.proofs.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <a href={`/api/v1/statutory/proofs/${decl.id}/${p.id}`} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">
                    {p.name}
                  </a>
                  <span className="text-xs text-ink-500">{Math.ceil(p.size / 1024)} KB</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card className="mb-5">
        <CardHeader title={t("statutory.tax.comparison")} description={t("statutory.tax.comparisonHelp")} icon={<Scale className="size-4.5" aria-hidden="true" />} />
        <CardBody>
          <TaxComparison workings={d.workings} chosen={d.chosen} />
          <p className="mt-3 text-sm text-ink-600">
            {t("statutory.tax.tdsSoFar")}: <span className="tabular font-medium text-ink-900">{formatINR(d.tdsSoFar)}</span>
            {d.lastTax && <span className="ml-2 text-xs text-ink-500">· {tDynamic(t, `statutory.tax.basis.${d.lastTax.basis}`)}</span>}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("statutory.tax.carryIn")} description={t("statutory.tax.carryInHelp")} icon={<Landmark className="size-4.5" aria-hidden="true" />} />
        <CardBody className="space-y-4">
          {d.carriedIn ? (
            <p className="text-sm text-ink-800">
              {formatINR(d.carriedIn.salary)} · TDS {formatINR(d.carriedIn.tds)} — <span className="text-ink-600">{d.carriedIn.note}</span>
            </p>
          ) : (
            <p className="text-sm text-ink-600">{t("statutory.tax.carryInNone")}</p>
          )}
          {d.carryInTaskId ? <Badge tone="amber">{t("statutory.tax.carryInWaiting")}</Badge> : d.canManage && <CarryInForm employeeId={d.employee.id} fy={d.fy} initial={d.carriedIn} />}
        </CardBody>
      </Card>
    </div>
  );
}
