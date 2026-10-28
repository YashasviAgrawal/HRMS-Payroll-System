import type { Metadata } from "next";
import Link from "next/link";
import { FileStack } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink } from "@/components/ui/row-link";
import { Table, Td, Th, THead } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatMonth, shiftMonth, todayIST } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { supplementaryBills } from "@/modules/payroll/arrears";
import { STATUS_TONE } from "@/modules/payroll/present";
import { PayrollTabs } from "../_components/payroll-tabs";
import { BillMaker } from "./bill-maker";

export const metadata: Metadata = { title: "Arrears and supplementary bills" };

/** S-42: arrears as due vs drawn (PR-08) and supplementary bills for arrears, withheld pay and joiners. */
export default async function ArrearsPage() {
  const actor = await requireActor();
  if (!canAll(actor, "arrears_loans", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const bills = await supplementaryBills(actor);
  const month = todayIST().slice(0, 7);

  return (
    <div>
      <PageHeader title={t("payroll.title")} description={t("payroll.supplementary.subtitle")} />
      <PayrollTabs active="arrears" principal={actor} t={t} />
      {canAll(actor, "arrears_loans", "create") && <BillMaker defaultFrom={shiftMonth(month, -3)} defaultTo={shiftMonth(month, -1)} lastMonth={shiftMonth(month, -1)} />}
      <Card className="mt-5">
        <CardHeader title={t("payroll.supplementary.list")} icon={<FileStack className="size-4.5" aria-hidden="true" />} />
        {bills.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("payroll.supplementary.noneYet")}</p>
          </CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("payroll.supplementary.bill")}</Th>
                <Th>{t("payroll.month")}</Th>
                <Th align="right">{t("payroll.people")}</Th>
                <Th align="right">{t("payroll.net")}</Th>
                <Th>{t("payroll.columns.status")}</Th>
              </tr>
            </THead>
            <tbody>
              {bills.map((b) => (
                <RowLink key={b.id} href={`/payroll/${b.id}`}>
                  <Td>
                    <Link href={`/payroll/${b.id}`} className="font-medium text-ink-900 hover:text-brand-700">
                      {locale === "hi" ? b.titleHi : b.title}
                    </Link>
                    {b.reason && !["WITHHELD", "JOINER", "SETTLEMENT"].includes(b.reason) && <span className="block text-xs text-ink-500">{b.reason}</span>}
                  </Td>
                  <Td label={t("payroll.month")}>{formatMonth(b.month, locale)}</Td>
                  <Td label={t("payroll.people")} align="right">
                    {b.employees}
                  </Td>
                  <Td label={t("payroll.net")} align="right" className="font-semibold">
                    {formatINR(b.net)}
                  </Td>
                  <Td label={t("payroll.columns.status")}>
                    <Badge tone={STATUS_TONE[b.status]}>{tDynamic(t, `payroll.status.${b.status}`)}</Badge>
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
