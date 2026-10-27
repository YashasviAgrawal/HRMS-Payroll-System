import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, FileText, Layers, ListChecks, Printer, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink } from "@/components/ui/row-link";
import { StatTile } from "@/components/ui/stat-tile";
import { Stepper } from "@/components/ui/stepper";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import type { Actor } from "@/lib/auth/session";
import { formatDateTime, formatMonth } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { NET_CHANGE_LIMIT_PCT } from "@/modules/payroll/checks";
import { signedPct, STAGE_KEYS, STATUS_TONE, stageIndex } from "@/modules/payroll/present";
import { getRun } from "@/modules/payroll/run";
import { ExceptionsList } from "./exceptions-list";
import { StagePanel } from "./stage-panel";

const TABS = ["exceptions", "people", "sections", "heads", "prints"] as const;
type Tab = (typeof TABS)[number];

/** Where a bill lives: salary bills under Payroll, pension bills under Pension (S-61, the same five stages). */
export type RunBase = "/payroll" | "/pension/bills";
export const baseOf = (payGroup: string): RunBase => (payGroup === "PENSION" ? "/pension/bills" : "/payroll");

/** S-40 / S-61: one bill through its five stages. */
export async function RunScreen({ actor, id, tab: tabParam, base }: { actor: Actor; id: string; tab?: string; base: RunBase }) {
  const { t, locale } = await getT();
  const data = await getRun(actor, id);
  const { run } = data;
  if (baseOf(run.payGroup) !== base) redirect(`${baseOf(run.payGroup)}/${run.id}${tabParam ? `?tab=${tabParam}` : ""}`);
  const pension = run.payGroup === "PENSION";
  const defaultTab: Tab = run.status === "DRAFT" && data.exceptions.length ? "exceptions" : run.status === "CHECKING" ? "sections" : "people";
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : defaultTab;
  const steps = STAGE_KEYS.map((k) => t(`payroll.stages.${k}`));
  const title = locale === "hi" ? data.titleHi : data.title;
  const change = data.previous && data.previous.net > 0 ? ((run.net - data.previous.net) / data.previous.net) * 100 : null;
  const bigChanges = data.people.filter((p) => p.changePct !== null && Math.abs(p.changePct) > NET_CHANGE_LIMIT_PCT).length;
  const href = (k: Tab) => `${base}/${run.id}?tab=${k}`;

  return (
    <div>
      <PageHeader
        breadcrumbs={[pension ? { label: t("pension.title"), href: `/pension?month=${run.month}` } : { label: t("payroll.title"), href: `/payroll?month=${run.month}` }, { label: formatMonth(run.month, locale) }]}
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t("payroll.ranBy", { name: run.runByName, when: formatDateTime(run.runAt, locale) })}</span>
            <span className="text-ink-400">·</span>
            <span>{t("payroll.version", { n: run.version })}</span>
          </span>
        }
        actions={<Badge tone={STATUS_TONE[run.status]}>{tDynamic(t, `payroll.status.${run.status}`)}</Badge>}
      />

      <Card className="mb-5">
        <CardBody className="py-4">
          <Stepper steps={steps} current={stageIndex(run.status)} label={pension ? t("pension.title") : t("payroll.title")} />
        </CardBody>
      </Card>

      {data.lastReturn && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{t("payroll.returned", { name: data.lastReturn.by ?? "", note: data.lastReturn.note ?? "" })}</p>
        </div>
      )}
      {run.status === "DRAFT" && run.reopenNote && !data.lastReturn && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{t("payroll.reopened", { note: run.reopenNote })}</p>
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={pension ? t("pension.bills.paid") : t("payroll.peoplePaid")} value={run.employees} icon={<Users className="size-5" aria-hidden="true" />} tone="blue" hint={data.people.length > run.employees ? `${data.people.length - run.employees} ${t("payroll.withheld").toLowerCase()}` : undefined} />
        <StatTile label={t("payroll.gross")} value={formatINR(run.gross)} icon={<Layers className="size-5" aria-hidden="true" />} tone="gray" />
        <StatTile label={t("payroll.deductions")} value={formatINR(run.deductions)} icon={<ListChecks className="size-5" aria-hidden="true" />} tone="gray" hint={pension ? undefined : `${t("payroll.employer")}: ${formatINR(run.employer)}`} />
        <StatTile label={pension ? t("pension.bills.net") : t("payroll.net")} value={formatINR(run.net)} icon={<FileText className="size-5" aria-hidden="true" />} hint={change === null ? t("payroll.noLast") : t("payroll.vsLast", { pct: signedPct(change) })} />
      </div>

      <StagePanel
        runId={run.id}
        status={run.status}
        can={data.can}
        open={data.open}
        failed={data.failed}
        bankFile={data.bankFile}
        files={data.files}
        approvedBy={run.approvedByName}
        approvedAt={run.approvedAt ? formatDateTime(run.approvedAt, locale) : null}
        closedAt={run.closedAt ? formatDateTime(run.closedAt, locale) : null}
        returnAt={run.returnAt ? formatDateTime(run.returnAt, locale) : null}
        payGroup={run.payGroup}
        month={run.month}
      />

      <LinkTabs
        className="mb-5 mt-6"
        active={tab}
        tabs={TABS.map((k) => ({ key: k, label: t(`payroll.tabsRun.${k}`), href: href(k), count: k === "exceptions" ? data.open : k === "people" ? data.people.length : undefined }))}
      />

      {tab === "exceptions" && (
        <Card>
          <CardHeader title={t("payroll.exceptions.title")} icon={<AlertTriangle className="size-4.5" aria-hidden="true" />} />
          <ExceptionsList runId={run.id} items={data.exceptions} canResolve={data.can.resolve} />
        </Card>
      )}

      {tab === "people" && (
        <Card>
          <Table stack>
            <THead>
              <tr>
                <Th>{pension ? t("pension.bills.pensioner") : t("payroll.columns.employee")}</Th>
                <Th>{t("payroll.columns.days")}</Th>
                <Th align="right">{t("payroll.columns.gross")}</Th>
                <Th align="right">{t("payroll.columns.deductions")}</Th>
                <Th align="right">{pension ? t("pension.bills.net") : t("payroll.columns.net")}</Th>
                <Th align="right">{t("payroll.columns.change")}</Th>
                <Th>{t("payroll.columns.status")}</Th>
              </tr>
            </THead>
            <tbody>
              {data.people.map((p) => (
                <RowLink key={p.id} href={`${base}/${run.id}/people/${p.id}`} className={p.status === "WITHHELD" ? "bg-amber-50/40" : undefined}>
                  <Td>
                    <Link href={`${base}/${run.id}/people/${p.id}`} className="font-medium text-ink-900 hover:text-brand-700">
                      {locale === "hi" && p.nameHi ? p.nameHi : p.name}
                    </Link>
                    <p className="text-xs text-ink-500">
                      {p.code} · {locale === "hi" ? p.post.nameHi : p.post.name} · {locale === "hi" ? p.section?.nameHi : p.section?.name}
                    </p>
                  </Td>
                  <Td label={t("payroll.columns.days")} className="text-sm">
                    {p.daysOnRoll > 0 ? <span className="block">{pension ? t("pension.bills.daysShort", { days: p.daysOnRoll }) : t("payroll.daysShort", { onRoll: p.daysOnRoll })}</span> : <span className="block text-ink-400">—</span>}
                    {p.lossDays > 0 && <span className="block text-xs text-red-700">{t("payroll.lossShort", { days: p.lossDays })}</span>}
                    {p.halfPayDays > 0 && <span className="block text-xs text-amber-700">{t("payroll.halfShort", { days: p.halfPayDays })}</span>}
                    {p.workedDays !== null && p.type === "DAILY_WAGE" && <span className="block text-xs text-ink-500">{t("payroll.workedShort", { days: p.workedDays })}</span>}
                  </Td>
                  <Td label={t("payroll.columns.gross")} align="right">
                    {formatINR(p.gross)}
                  </Td>
                  <Td label={t("payroll.columns.deductions")} align="right">
                    {formatINR(p.deductions)}
                  </Td>
                  <Td label={t("payroll.columns.net")} align="right" className="font-semibold text-ink-950">
                    {formatINR(p.net)}
                  </Td>
                  <Td label={t("payroll.columns.change")} align="right" className={cn("text-sm", p.changePct !== null && Math.abs(p.changePct) > NET_CHANGE_LIMIT_PCT ? "font-semibold text-amber-700" : "text-ink-500")}>
                    {p.changePct === null ? "—" : `${signedPct(p.changePct)}%`}
                  </Td>
                  <Td label={t("payroll.columns.status")}>
                    <div className="flex flex-wrap gap-1">
                      {p.status === "WITHHELD" ? <Badge tone="amber">{t("payroll.withheld")}</Badge> : p.creditStatus ? <Badge tone={p.creditStatus === "FAILED" ? "red" : "green"}>{tDynamic(t, `payroll.credit.${p.creditStatus}`)}</Badge> : <Badge tone="green">{t("payroll.included")}</Badge>}
                      {p.isSelf && <Badge tone="blue">{t("payroll.self")}</Badge>}
                    </div>
                  </Td>
                </RowLink>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {tab === "sections" && (
        <Card>
          <CardHeader title={t("payroll.tabsRun.sections")} description={bigChanges ? t("payroll.exceptions.codes.NET_CHANGE") + ` — ${bigChanges}` : undefined} />
          <Table stack>
            <THead>
              <tr>
                <Th>{t("payroll.columns.section")}</Th>
                <Th align="right">{t("payroll.columns.people")}</Th>
                <Th align="right">{t("payroll.columns.gross")}</Th>
                <Th align="right">{t("payroll.columns.deductions")}</Th>
                <Th align="right">{t("payroll.columns.net")}</Th>
                <Th align="right">{t("payroll.columns.lastNet")}</Th>
                <Th align="right">{t("payroll.columns.change")}</Th>
              </tr>
            </THead>
            <tbody>
              {data.sections.map((s) => {
                const pct = s.lastNet > 0 ? ((s.net - s.lastNet) / s.lastNet) * 100 : null;
                return (
                  <Tr key={s.sectionId}>
                    <Td className="font-medium text-ink-900">{locale === "hi" ? s.nameHi : s.name}</Td>
                    <Td label={t("payroll.columns.people")} align="right">
                      {s.people}
                    </Td>
                    <Td label={t("payroll.columns.gross")} align="right">
                      {formatINR(s.gross)}
                    </Td>
                    <Td label={t("payroll.columns.deductions")} align="right">
                      {formatINR(s.deductions)}
                    </Td>
                    <Td label={t("payroll.columns.net")} align="right" className="font-semibold text-ink-950">
                      {formatINR(s.net)}
                    </Td>
                    <Td label={t("payroll.columns.lastNet")} align="right" className="text-ink-500">
                      {s.lastNet ? formatINR(s.lastNet) : "—"}
                    </Td>
                    <Td label={t("payroll.columns.change")} align="right" className={cn(pct !== null && Math.abs(pct) > NET_CHANGE_LIMIT_PCT ? "font-semibold text-amber-700" : "text-ink-500")}>
                      {pct === null ? "—" : `${signedPct(pct)}%`}
                    </Td>
                  </Tr>
                );
              })}
              <Tr className="bg-brand-50/50 font-semibold">
                <Td>{t("common.total")}</Td>
                <Td label={t("payroll.columns.people")} align="right">
                  {run.employees}
                </Td>
                <Td label={t("payroll.columns.gross")} align="right">
                  {formatINR(run.gross)}
                </Td>
                <Td label={t("payroll.columns.deductions")} align="right">
                  {formatINR(run.deductions)}
                </Td>
                <Td label={t("payroll.columns.net")} align="right">
                  {formatINR(run.net)}
                </Td>
                <Td label={t("payroll.columns.lastNet")} align="right">
                  {data.previous ? formatINR(data.previous.net) : "—"}
                </Td>
                <Td label={t("payroll.columns.change")} align="right">
                  {change === null ? "—" : `${signedPct(change)}%`}
                </Td>
              </Tr>
            </tbody>
          </Table>
        </Card>
      )}

      {tab === "heads" && (
        <div className="grid gap-5 lg:grid-cols-2">
          {(["EARNING", "DEDUCTION", "EMPLOYER"] as const).map((kind) => {
            const rows = data.heads.filter((h) => h.kind === kind);
            if (!rows.length) return null;
            return (
              <Card key={kind} className={kind === "EARNING" ? "lg:row-span-2" : undefined}>
                <CardHeader title={t(`payroll.kinds.${kind}`)} />
                <Table>
                  <THead>
                    <tr>
                      <Th>{t("payroll.columns.head")}</Th>
                      <Th align="right">{t("payroll.columns.amount")}</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {rows.map((h) => (
                      <Tr key={h.code}>
                        <Td>
                          <span className="font-medium text-ink-900">{locale === "hi" ? h.nameHi : h.name}</span>
                          <span className="block text-xs text-ink-500">{h.accountHead}</span>
                        </Td>
                        <Td align="right">{formatINR(h.amount)}</Td>
                      </Tr>
                    ))}
                    <Tr className="bg-brand-50/50 font-semibold">
                      <Td>{t("common.total")}</Td>
                      <Td align="right">{formatINR(rows.reduce((s, h) => s + h.amount, 0))}</Td>
                    </Tr>
                  </tbody>
                </Table>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "prints" && (
        <Card>
          <CardHeader title={t("payroll.prints.title")} description={t("payroll.prints.help")} icon={<Printer className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <ul className="grid gap-3 sm:grid-cols-2">
              {(["paybill", "register", "schedules", "acquittance"] as const).map((doc) => (
                <li key={doc}>
                  <a
                    href={`/api/v1/payroll/runs/${run.id}/print/${doc}`}
                    target="_blank"
                    rel="noopener"
                    className="flex items-center gap-3 rounded-xl border border-ink-200 px-4 py-3 text-sm font-medium text-ink-800 transition-colors hover:border-brand-300 hover:bg-brand-50/40 hover:text-brand-800"
                  >
                    <FileText className="size-5 text-brand-700" aria-hidden="true" />
                    {t(`payroll.prints.${doc}`)}
                  </a>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
