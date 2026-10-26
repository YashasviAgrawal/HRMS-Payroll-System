import type { Metadata } from "next";
import Link from "next/link";
import { FileSearch, HandCoins, Percent, PiggyBank } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink } from "@/components/ui/row-link";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime, formatMonth } from "@/lib/dates";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { gpfAccounts, gpfInterestSummary } from "@/modules/statutory/gpf";
import { craReconciliations, npsAccounts } from "@/modules/statutory/stat-files";
import { ActionButton } from "../_components/action-button";
import { StatutoryTabs } from "../_components/statutory-tabs";
import { CraUpload } from "./cra-upload";

export const metadata: Metadata = { title: "GPF and NPS" };

/** S-50: GPF accounts and the year's interest; NPS contributions and the CRA statement check. */
export default async function FundsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "statutory", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const view = (await searchParams).view === "nps" ? "nps" : "gpf";

  const toggle = (
    <div className="mb-4 inline-flex gap-1 rounded-xl bg-ink-100 p-1" role="group" aria-label={t("statutory.tabs.funds")}>
      {(["gpf", "nps"] as const).map((v) => (
        <Link key={v} href={`/statutory/funds?view=${v}`} aria-current={view === v ? "page" : undefined} className={cn("rounded-lg px-4 py-1.5 text-sm font-semibold", view === v ? "bg-white text-brand-800 shadow-card" : "text-ink-600 hover:text-ink-900")}>
          {t(`statutory.gpf.views.${v}`)}
        </Link>
      ))}
    </div>
  );

  if (view === "nps") {
    const [accounts, recons] = await Promise.all([npsAccounts(actor), craReconciliations(actor)]);
    return (
      <div>
        <PageHeader title={t("statutory.title")} description={t("statutory.nps.help")} />
        <StatutoryTabs active="funds" t={t} />
        {toggle}
        <Card className="mb-5">
          <CardHeader title={t("statutory.nps.reconcile")} description={t("statutory.nps.reconcileHelp")} icon={<FileSearch className="size-4.5" aria-hidden="true" />} />
          <CardBody>{canAll(actor, "statutory", "create") ? <CraUpload /> : null}</CardBody>
          {recons.length > 0 && (
            <CardFooter className="block">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{t("statutory.nps.earlier")}</p>
              <ul className="space-y-1 text-sm">
                {recons.map((r) => (
                  <li key={r.id} className="flex flex-wrap justify-between gap-2">
                    <span className="text-ink-800">
                      {r.fileName} · {r.createdByName} · {formatDateTime(r.createdAt, locale)}
                    </span>
                    <span className="text-ink-600">{t("statutory.nps.result", { matched: Number(r.summary?.matched ?? 0), different: Number(r.summary?.different ?? 0), notCredited: Number(r.summary?.notCredited ?? 0), notOurs: Number(r.summary?.notOurs ?? 0) })}</span>
                  </li>
                ))}
              </ul>
            </CardFooter>
          )}
        </Card>
        <Card>
          <CardHeader title={t("statutory.nps.title")} icon={<PiggyBank className="size-4.5" aria-hidden="true" />} />
          {accounts.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-600">{t("statutory.nps.none")}</p>
            </CardBody>
          ) : (
            <Table stack>
              <THead>
                <tr>
                  <Th>{t("statutory.employee")}</Th>
                  <Th>{t("statutory.nps.pran")}</Th>
                  <Th align="right">{t("statutory.nps.yearOwn")}</Th>
                  <Th align="right">{t("statutory.nps.yearBoard")}</Th>
                  <Th align="right">{t("statutory.nps.total")}</Th>
                </tr>
              </THead>
              <tbody>
                {accounts.map((a) => (
                  <Tr key={a.employeeId}>
                    <Td>
                      <span className="font-medium text-ink-900">{locale === "hi" && a.nameHi ? a.nameHi : a.name}</span>
                      <span className="block text-xs text-ink-500">
                        {a.code} · {formatMonth(a.lastMonth, locale)}
                      </span>
                    </Td>
                    <Td label={t("statutory.nps.pran")} className="tabular">
                      {a.pran ?? <Badge tone="amber">—</Badge>}
                    </Td>
                    <Td label={t("statutory.nps.yearOwn")} align="right">
                      {formatINR(a.year)}
                    </Td>
                    <Td label={t("statutory.nps.yearBoard")} align="right">
                      {formatINR(a.yearBoard)}
                    </Td>
                    <Td label={t("statutory.nps.total")} align="right" className="font-semibold text-ink-950">
                      {formatINR(a.total + a.totalBoard)}
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

  const data = await gpfAccounts(actor);
  const lastFy = `${Number(data.fy.slice(0, 4)) - 1}-${data.fy.slice(2, 4)}`;
  const interest = await gpfInterestSummary(actor, lastFy);

  return (
    <div>
      <PageHeader title={t("statutory.title")} description={t("statutory.gpf.subtitle")} />
      <StatutoryTabs active="funds" t={t} />
      {toggle}
      <Card className="mb-5">
        <CardHeader title={t("statutory.gpf.interestTitle", { fy: lastFy })} description={t("statutory.gpf.interestHelp")} icon={<Percent className="size-4.5" aria-hidden="true" />} />
        <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="font-medium text-ink-900">{interest.interest > 0 || interest.credited ? t("statutory.gpf.interestWorked", { accounts: interest.accounts, amount: formatINR(interest.interest) }) : t("statutory.gpf.interestNone", { fy: lastFy })}</span>
          {interest.credited ? (
            <Badge tone="green">{t("statutory.gpf.interestCredited")}</Badge>
          ) : interest.waiting ? (
            <Badge tone="amber">{t("statutory.gpf.interestWaiting")}</Badge>
          ) : !interest.yearOver ? (
            <span className="text-ink-500">{t("statutory.gpf.interestNotOver")}</span>
          ) : (
            interest.canPropose &&
            interest.interest > 0 && (
              <ActionButton url="/api/v1/statutory/gpf/interest" body={{ fy: lastFy }} done={t("statutory.sentToAdmin")} variant="primary">
                {t("statutory.gpf.interestSend")}
              </ActionButton>
            )
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("statutory.gpf.accounts")} icon={<HandCoins className="size-4.5" aria-hidden="true" />} />
        {data.rows.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("statutory.gpf.none")}</p>
          </CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("statutory.employee")}</Th>
                <Th>{t("statutory.gpf.number")}</Th>
                <Th align="right">{t("statutory.gpf.balance")}</Th>
                <Th align="right">{t("statutory.gpf.thisYear")}</Th>
                <Th align="right">{t("statutory.gpf.advanceLeft")}</Th>
              </tr>
            </THead>
            <tbody>
              {data.rows.map((r) => (
                <RowLink key={r.employeeId} href={`/statutory/funds/${r.employeeId}`}>
                  <Td>
                    <Link href={`/statutory/funds/${r.employeeId}`} className="font-medium text-ink-900 hover:text-brand-700">
                      {locale === "hi" && r.nameHi ? r.nameHi : r.name}
                    </Link>
                    <span className="block text-xs text-ink-500">
                      {r.code}
                      {r.waiting && <span className="ml-2 font-medium text-amber-700">{t("statutory.gpf.waiting")}</span>}
                    </span>
                  </Td>
                  <Td label={t("statutory.gpf.number")}>{r.gpfNumber ?? "—"}</Td>
                  <Td label={t("statutory.gpf.balance")} align="right" className="font-semibold text-ink-950">
                    {formatINR(r.balance)}
                  </Td>
                  <Td label={t("statutory.gpf.thisYear")} align="right">
                    {formatINR(r.subscribedThisYear)}
                  </Td>
                  <Td label={t("statutory.gpf.advanceLeft")} align="right">
                    {r.advanceLeft ? formatINR(r.advanceLeft) : "—"}
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
