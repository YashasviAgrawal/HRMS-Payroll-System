import { Download, Landmark, ListOrdered, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { formatDate, formatMonth } from "@/lib/dates";
import { tDynamic, type TFunction } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/types";
import { formatINR } from "@/lib/money";
import type { gpfAccount } from "@/modules/statutory/gpf";
import { PeriodPicker } from "./year-picker";

type Account = Awaited<ReturnType<typeof gpfAccount>>;
const ADV_TONE = { PENDING: "amber", RUNNING: "blue", CLOSED: "gray", REJECTED: "red" } as const;

/** §9 GPF, S-50: one account's year — the same view for HR & Accounts and for the employee. */
export function GpfAccountView({ a, t, locale, href }: { a: Account; t: TFunction; locale: Locale; href: (fy: string) => string }) {
  const y = a.year;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label={t("statutory.gpf.balance")} value={formatINR(a.balance)} hint={a.employee.gpfNumber ?? undefined} icon={<Wallet className="size-4.5" aria-hidden="true" />} />
        <StatTile label={t("statutory.gpf.interestSoFar")} value={formatINR(y.interestCredited || y.interest)} hint={t("statutory.gpf.rateNow", { rate: a.rate })} tone="blue" />
        <StatTile label={t("statutory.gpf.creditedThisYear")} value={formatINR(y.credits)} hint={y.debits ? `${t("statutory.gpf.debits")}: ${formatINR(y.debits)}` : undefined} tone="gray" />
      </div>
      <PeriodPicker options={a.years} active={a.fy} href={href} label={t("statutory.fy")} />
      <Card>
        <CardHeader
          title={t("statutory.gpf.monthByMonth")}
          description={`${t("statutory.fy")} ${a.fy}`}
          icon={<ListOrdered className="size-4.5" aria-hidden="true" />}
          actions={
            <a href={`/api/v1/statutory/gpf/${a.employee.id}/statement?fy=${a.fy}`} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
              <Download className="size-4" aria-hidden="true" />
              {t("statutory.gpf.statement", { fy: a.fy })}
            </a>
          }
        />
        <Table stack>
          <THead>
            <tr>
              <Th>{t("statutory.month")}</Th>
              <Th align="right">{t("statutory.gpf.credits")}</Th>
              <Th align="right">{t("statutory.gpf.debits")}</Th>
              <Th align="right">{t("statutory.gpf.balance")}</Th>
              <Th align="right">{t("statutory.gpf.rate")}</Th>
              <Th align="right">{t("statutory.gpf.interest")}</Th>
            </tr>
          </THead>
          <tbody>
            <Tr>
              <Td className="font-medium text-ink-700">{t("statutory.gpf.opening")}</Td>
              <Td label={t("statutory.gpf.credits")} align="right" />
              <Td label={t("statutory.gpf.debits")} align="right" />
              <Td label={t("statutory.gpf.balance")} align="right" className="font-medium">
                {formatINR(y.opening)}
              </Td>
              <Td label={t("statutory.gpf.rate")} align="right" />
              <Td label={t("statutory.gpf.interest")} align="right" />
            </Tr>
            {y.months.map((m) => (
              <Tr key={m.month}>
                <Td className="text-ink-900">{formatMonth(m.month, locale)}</Td>
                <Td label={t("statutory.gpf.credits")} align="right">
                  {m.credits ? formatINR(m.credits) : "—"}
                </Td>
                <Td label={t("statutory.gpf.debits")} align="right">
                  {m.debits ? formatINR(m.debits) : "—"}
                </Td>
                <Td label={t("statutory.gpf.balance")} align="right" className="font-medium text-ink-950">
                  {formatINR(m.balance)}
                </Td>
                <Td label={t("statutory.gpf.rate")} align="right">
                  {m.rate}
                </Td>
                <Td label={t("statutory.gpf.interest")} align="right">
                  {formatINR(m.interest)}
                </Td>
              </Tr>
            ))}
            <Tr className="bg-brand-50/50">
              <Td className="font-semibold text-ink-900">{t("statutory.gpf.closing")}</Td>
              <Td label={t("statutory.gpf.credits")} align="right" className="font-medium">
                {formatINR(y.credits)}
              </Td>
              <Td label={t("statutory.gpf.debits")} align="right" className="font-medium">
                {formatINR(y.debits)}
              </Td>
              <Td label={t("statutory.gpf.balance")} align="right" className="font-semibold text-ink-950">
                {formatINR(y.closing)}
              </Td>
              <Td label={t("statutory.gpf.rate")} align="right" />
              <Td label={t("statutory.gpf.interest")} align="right" className="font-medium">
                {formatINR(y.interestCredited || y.interest)}
              </Td>
            </Tr>
          </tbody>
        </Table>
      </Card>
      <Card>
        <CardHeader title={t("statutory.gpf.entries")} icon={<Landmark className="size-4.5" aria-hidden="true" />} />
        {a.entries.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("statutory.gpf.noEntries")}</p>
          </CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("statutory.month")}</Th>
                <Th>{t("statutory.gpf.kind")}</Th>
                <Th align="right">{t("statutory.amount")}</Th>
              </tr>
            </THead>
            <tbody>
              {a.entries.map((e) => (
                <Tr key={e.id}>
                  <Td>{formatMonth(e.month, locale)}</Td>
                  <Td label={t("statutory.gpf.kind")}>
                    {tDynamic(t, `statutory.gpf.kinds.${e.kind}`)}
                    <span className="block text-xs text-ink-500">{e.note ?? (e.runId ? t("statutory.gpf.fromPayBill") : "")}</span>
                  </Td>
                  <Td label={t("statutory.amount")} align="right" className={e.amount < 0 ? "font-medium text-red-700" : "font-medium text-ink-900"}>
                    {e.amount < 0 ? `− ${formatINR(-e.amount)}` : formatINR(e.amount)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={t("statutory.gpf.advances")} icon={<Wallet className="size-4.5" aria-hidden="true" />} />
        {a.advances.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("statutory.gpf.noAdvances")}</p>
          </CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("statutory.gpf.kind")}</Th>
                <Th align="right">{t("statutory.amount")}</Th>
                <Th>{t("statutory.gpf.order")}</Th>
                <Th align="right">{t("statutory.gpf.advanceLeft")}</Th>
                <Th>{t("statutory.status")}</Th>
              </tr>
            </THead>
            <tbody>
              {a.advances.map((x) => (
                <Tr key={x.id}>
                  <Td>
                    {tDynamic(t, `statutory.gpf.advanceKinds.${x.kind}`)}
                    <span className="block text-xs text-ink-500">{x.purpose}</span>
                  </Td>
                  <Td label={t("statutory.amount")} align="right">
                    {formatINR(x.amount)}
                    {x.instalments > 0 && <span className="block text-xs text-ink-500">{x.instalments} × {formatINR(x.instalmentAmount)}</span>}
                  </Td>
                  <Td label={t("statutory.gpf.order")}>
                    {x.orderNumber}
                    <span className="block text-xs text-ink-500">{formatDate(x.sanctionDate, locale)}</span>
                  </Td>
                  <Td label={t("statutory.gpf.advanceLeft")} align="right" className="font-medium">
                    {x.kind === "ADVANCE" ? formatINR(x.left) : "—"}
                  </Td>
                  <Td label={t("statutory.status")}>
                    <Badge tone={ADV_TONE[x.status]}>{tDynamic(t, `statutory.gpf.advanceStatus.${x.status}`)}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
