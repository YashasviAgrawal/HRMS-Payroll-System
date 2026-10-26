import type { Metadata } from "next";
import { Printer, ScrollText } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { requireActor } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { fullName } from "@/modules/employees/present";
import { employeeLeave } from "@/modules/leave/service";
import { BalanceCards } from "../../_components/balance-cards";

export const metadata: Metadata = { title: "Leave account" };

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** LV-07: credits, debits and running balance, per leave; printable for the service book. */
export default async function LedgerPage({ params }: { params: Promise<{ employeeId: string }> }) {
  const actor = await requireActor();
  const { employeeId: raw } = await params;
  const employeeId = raw === "me" ? actor.employeeId : raw;
  if (!employeeId) return <NoAccess />;
  const { t, locale } = await getT();
  const data = await employeeLeave(actor, employeeId);
  const e = data.employee;
  const own = actor.employeeId === e.id;
  const codes = data.types.map((x) => x.code).filter((c) => data.lines.some((l) => l.code === c));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        breadcrumbs={[{ label: t("leave.title"), href: own ? "/leave" : actor.loginType === "EMPLOYEE" ? "/my/team/leave" : "/leave/manage?tab=balances" }, { label: t("leave.account") }]}
        title={`${t("leave.account")} · ${(locale === "hi" && e.nameHi) || fullName(e)}`}
        description={`${e.employeeCode} · ${locale === "hi" ? e.post.nameHi : e.post.name} · ${locale === "hi" ? e.section.nameHi : e.section.name}`}
        actions={
          <a href={`/api/v1/leave/employees/${e.id}/ledger`} target="_blank" rel="noopener" className={buttonClass("primary")}>
            <Printer className="size-4" aria-hidden="true" /> {t("leave.print")}
          </a>
        }
      />
      <BalanceCards balances={data.balances} t={t} locale={locale} />
      {codes.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-600">{t("leave.ledger.empty")}</p>
          </CardBody>
        </Card>
      ) : (
        codes.map((code) => {
          const type = data.types.find((x) => x.code === code)!;
          const lines = data.lines.filter((l) => l.code === code);
          return (
            <Card key={code}>
              <CardHeader title={`${locale === "hi" ? type.nameHi : type.name} (${code})`} description={code === codes[0] ? t("leave.accountSubtitle") : undefined} icon={<ScrollText className="size-4.5" aria-hidden="true" />} actions={<Badge tone="green">{fmt(lines.at(-1)!.balance)}</Badge>} />
              <Table stack>
                <THead>
                  <tr>
                    <Th>{t("leave.ledger.date")}</Th>
                    <Th>{t("leave.ledger.entry")}</Th>
                    <Th>{t("leave.ledger.details")}</Th>
                    <Th align="right">{t("leave.ledger.credit")}</Th>
                    <Th align="right">{t("leave.ledger.debit")}</Th>
                    <Th align="right">{t("leave.ledger.balance")}</Th>
                  </tr>
                </THead>
                <tbody>
                  {lines.map((l, i) => (
                    <Tr key={i}>
                      <Td className="whitespace-nowrap">{formatDate(l.date, locale)}</Td>
                      <Td label={t("leave.ledger.entry")}>
                        <Badge tone={l.kind === "DEBIT" || l.kind === "LAPSE" ? "amber" : l.kind === "OPENING" ? "gray" : "green"}>{tDynamic(t, `leave.kinds.${l.kind}`)}</Badge>
                      </Td>
                      <Td label={t("leave.ledger.details")} className="max-w-sm text-ink-600">{l.note ?? "—"}</Td>
                      <Td align="right" label={t("leave.ledger.credit")} className="text-brand-800">{l.days > 0 ? fmt(l.days) : ""}</Td>
                      <Td align="right" label={t("leave.ledger.debit")} className="text-amber-800">{l.days < 0 ? fmt(-l.days) : ""}</Td>
                      <Td align="right" label={t("leave.ledger.balance")} className={cn("font-semibold", l.balance < 0 ? "text-red-700" : "text-ink-900")}>{fmt(l.balance)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          );
        })
      )}
    </div>
  );
}
