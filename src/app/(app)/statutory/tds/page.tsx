import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Receipt, Trash2, TriangleAlert } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDate, formatMonth, todayIST } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { fyOfMonth } from "@/modules/statutory/tax-rules";
import { tdsYear } from "@/modules/statutory/tds";
import { ActionButton } from "../_components/action-button";
import { FILE_TONE, StatutoryTabs } from "../_components/statutory-tabs";
import { PeriodPicker } from "../_components/year-picker";
import { ChallanDialog } from "./challan-dialog";

export const metadata: Metadata = { title: "TDS and 24Q" };

const TONE = { NOTHING: "gray", PENDING: "gray", DEPOSITED: "green", SHORT: "amber", DUE: "amber", OVERDUE: "red" } as const;

/** ST-05, ST-06, S-52: TDS deducted and deposited, challans, and each quarter's Form 24Q. */
export default async function TdsPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "statutory", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const data = await tdsYear(actor, (await searchParams).fy);
  const thisFy = fyOfMonth(todayIST().slice(0, 7));
  const prev = `${Number(thisFy.slice(0, 4)) - 1}-${thisFy.slice(2, 4)}`;

  return (
    <div>
      <PageHeader title={t("statutory.title")} description={t("statutory.tds.subtitle")} />
      <StatutoryTabs active="tds" t={t} />
      <PeriodPicker options={[thisFy, prev]} active={data.fy} href={(fy) => `/statutory/tds?fy=${fy}`} label={t("statutory.fy")} />
      <Card>
        <CardHeader
          title={t("statutory.tds.months")}
          icon={<Receipt className="size-4.5" aria-hidden="true" />}
          actions={data.canManage && data.months.length > 0 && <ChallanDialog months={data.months.map((m) => ({ month: m.month, due: Math.max(0, Math.round(m.tds - m.deposited)) }))} />}
        />
        <Table stack>
          <THead>
            <tr>
              <Th>{t("statutory.month")}</Th>
              <Th align="right">{t("statutory.tds.people")}</Th>
              <Th align="right">{t("statutory.tds.deducted")}</Th>
              <Th align="right">{t("statutory.tds.deposited")}</Th>
              <Th>{t("statutory.tds.dueBy")}</Th>
              <Th>{t("statutory.tds.challans")}</Th>
              <Th>{t("statutory.status")}</Th>
            </tr>
          </THead>
          <tbody>
            {data.months.map((m) => (
              <Tr key={m.month} data-testid={`tds-${m.month}`}>
                <Td className="font-medium text-ink-900">{formatMonth(m.month, locale)}</Td>
                <Td label={t("statutory.tds.people")} align="right">
                  {m.people}
                </Td>
                <Td label={t("statutory.tds.deducted")} align="right" className="font-semibold text-ink-950">
                  {formatINR(m.tds)}
                </Td>
                <Td label={t("statutory.tds.deposited")} align="right">
                  {formatINR(m.deposited)}
                </Td>
                <Td label={t("statutory.tds.dueBy")}>{formatDate(m.dueOn, locale)}</Td>
                <Td label={t("statutory.tds.challans")}>
                  {m.challans.length === 0 ? (
                    <span className="text-xs text-ink-400">{m.tds > 0 ? t("statutory.tds.noChallan") : "—"}</span>
                  ) : (
                    <ul className="space-y-1">
                      {m.challans.map((c) => (
                        <li key={c.id} className="flex items-center gap-2 text-xs text-ink-700">
                          <span className="tabular">
                            {c.bsrCode}/{c.challanNo} · {formatDate(c.depositedOn, locale)} · {formatINR(c.tax + c.cess + c.interest)}
                          </span>
                          {data.canManage && (
                            <ActionButton url={`/api/v1/statutory/tds/challans/${c.id}`} method="DELETE" done={t("statutory.tds.removed")} confirm={t("statutory.tds.removeConfirm")} variant="ghost" size="sm" aria-label={t("statutory.tds.remove")} icon={<Trash2 className="size-3.5" />} />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Td>
                <Td label={t("statutory.status")}>
                  <Badge tone={TONE[m.status as keyof typeof TONE]} dot>
                    {tDynamic(t, `statutory.tds.status.${m.status}`)}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <h2 className="mb-3 mt-7 text-base font-semibold text-ink-900">{t("statutory.tds.quarters")}</h2>
      <div className="grid gap-5 md:grid-cols-2">
        {data.quarters.map((q) => (
          <Card key={q.quarter} className="flex flex-col" data-testid={`quarter-${q.quarter}`}>
            <CardHeader
              title={t("statutory.tds.quarter", { q: q.quarter })}
              description={`${formatMonth(q.months[0], locale)} – ${formatMonth(q.months[2], locale)}`}
              icon={<FileText className="size-4.5" aria-hidden="true" />}
              actions={q.file && <Badge tone={FILE_TONE[q.file.status] ?? "gray"}>{tDynamic(t, `files.status.${q.file.status}`)}</Badge>}
            />
            <CardBody className="flex-1 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-600">{t("statutory.tds.deducted")}</span>
                <span className="tabular font-medium">{formatINR(q.tds)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-600">{t("statutory.tds.deposited")}</span>
                <span className="tabular font-medium">{formatINR(q.deposited)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-600">{t("statutory.tds.deductees")}</span>
                <span className="tabular font-medium">{q.deductees}</span>
              </div>
              {q.noPan > 0 && (
                <p className="flex gap-2 rounded-xl bg-amber-50 px-3 py-2 text-amber-900">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {t("statutory.tds.noPan", { count: q.noPan })}
                </p>
              )}
              {!q.ended ? (
                <p className="text-ink-500">{t("statutory.tds.notOver")}</p>
              ) : (
                q.short.length > 0 && <p className="text-amber-800">{t("statutory.tds.short", { months: q.short.map((m) => formatMonth(m, locale)).join(", ") })}</p>
              )}
              {q.file && (
                <p className="text-xs text-ink-500">
                  <Link href={`/files/${q.file.id}`} className="font-medium text-brand-700 hover:underline">
                    {q.file.fileName}
                  </Link>
                </p>
              )}
            </CardBody>
            {data.canManage && q.ended && q.short.length === 0 && q.tds > 0 && (!q.file || q.file.status === "REJECTED") && (
              <CardFooter>
                <ActionButton url="/api/v1/statutory/tds/24q" body={{ fy: data.fy, quarter: q.quarter }} done={t("statutory.tds.made24q")} variant="primary" icon={<FileText className="size-4" />}>
                  {t("statutory.tds.make24q")}
                </ActionButton>
              </CardFooter>
            )}
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-ink-500">{t("statutory.tds.fvuNote")}</p>
    </div>
  );
}
