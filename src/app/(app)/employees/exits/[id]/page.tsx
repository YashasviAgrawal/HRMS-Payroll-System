import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, FileDown, HandCoins, Hourglass, Info, Landmark, Scale, Wallet } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { Stepper } from "@/components/ui/stepper";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { requireActor } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/dates";
import { tDynamic, type TFunction } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/types";
import { formatINR } from "@/lib/money";
import { canSeeSeparations, getSeparation } from "@/modules/employees/separation";
import { STATUS_TONE } from "@/modules/payroll/present";
import { duesOnRecord, settlementView, type SettlementView } from "@/modules/payroll/settlement";
import type { StatementLine } from "@/modules/payroll/settlement-rules";
import { SEPARATION_TONE, SETTLEMENT_TONE } from "../tones";
import { MakeBillButton, ReceiptDialog, ReinstateDialog, SettlementEditor } from "./actions";

export const metadata: Metadata = { title: "Suspension or leaving" };

/** Client add-on: one suspension or leaving — the order, approvals, reinstatement, and the full and final settlement. */
export default async function SeparationPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (!canSeeSeparations(actor)) return <NoAccess />;
  const { t, locale } = await getT();
  const { id } = await params;
  const s = await getSeparation(actor, id);
  const exit = s.kind !== "SUSPENSION";
  const [settlement, dues] = await Promise.all([exit ? settlementView(actor, id).catch(() => null) : null, !exit && s.status !== "REJECTED" ? duesOnRecord(actor, s.employee.id) : null]);
  const name = locale === "hi" && s.employee.nameHi ? s.employee.nameHi : s.employee.name;
  const what = tDynamic(t, `employees.exit.kind.${s.kind}`);
  const waitingFor = s.tasks[0];

  const steps = exit
    ? [t("employees.exit.steps.record"), t("employees.exit.steps.approve"), t("employees.exit.steps.statement"), t("employees.exit.steps.pay")]
    : [t("employees.exit.steps.record"), t("employees.exit.steps.approve"), t("employees.exit.steps.suspended")];
  const current = exit
    ? s.status === "PENDING"
      ? waitingFor?.requiredPermission === "APPROVER" ? 1 : 0
      : s.status === "REJECTED"
        ? 0
        : ({ NONE: 2, CHECKING: 2, APPROVED: 3, SETTLED: 4 } as const)[s.settlementStatus as "NONE"]
    : s.status === "PENDING"
      ? waitingFor?.requiredPermission === "APPROVER" ? 1 : 0
      : s.status === "ENDED"
        ? 3
        : s.status === "APPROVED"
          ? 2
          : 0;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: t("employees.title"), href: "/employees" }, { label: t("employees.exit.title"), href: "/employees/exits" }, { label: name }]}
        title={`${what} — ${name}`}
        description={`${s.employee.code} · ${locale === "hi" ? s.employee.postHi : s.employee.post} · ${locale === "hi" ? s.employee.sectionHi : s.employee.section}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SEPARATION_TONE[s.status as keyof typeof SEPARATION_TONE]} dot>
              {tDynamic(t, `employees.exit.status.${s.kind === "SUSPENSION" && s.status === "APPROVED" ? "SUSPENDED" : s.status}`)}
            </Badge>
            <LinkButton href={`/employees/${s.employee.id}`} variant="secondary">
              {t("employees.exit.openProfile")}
            </LinkButton>
            {s.canReinstate && <ReinstateDialog id={s.id} />}
            {settlement && (
              <a href={`/api/v1/separations/${s.id}/settlement/pdf`} target="_blank" rel="noopener" className={buttonClass("secondary")}>
                <FileDown className="size-4" aria-hidden="true" /> {t("payroll.settlement.pdf")}
              </a>
            )}
          </div>
        }
      />

      {s.status !== "REJECTED" && (
        <Card className="mb-5">
          <CardBody className="py-4">
            <Stepper steps={steps} current={current} label={t("employees.exit.title")} />
          </CardBody>
        </Card>
      )}

      {s.tasks.map((task) => (
        <div key={task.id} role="status" className="mb-5 flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-gold-500/30 bg-gold-50/70 px-5 py-4">
          <div className="flex items-start gap-3">
            <Hourglass className="mt-0.5 size-5 shrink-0 text-gold-600" aria-hidden="true" />
            <div>
              <p className="font-medium text-ink-900">{locale === "hi" && task.titleHi ? task.titleHi : task.title}</p>
              <p className="mt-0.5 text-sm text-ink-600">{t("employees.exit.waitingWith", { role: tDynamic(t, `permission.${task.requiredPermission}`), name: task.makerName, date: formatDateTime(task.createdAt, locale) })}</p>
            </div>
          </div>
          <LinkButton href={`/approvals/${task.id}`} size="sm">
            {t("common.open")}
          </LinkButton>
        </div>
      ))}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title={t("employees.exit.details")} />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                { label: t("employees.exit.what"), value: what },
                { label: exit ? t("employees.exit.lastDay") : t("employees.exit.suspendedFrom"), value: formatDate(s.effectiveDate, locale) },
                { label: t("employees.exit.order"), value: `${s.orderNumber} · ${formatDate(s.orderDate, locale)}` },
                { label: t("employees.exit.reason"), value: s.reason },
                ...(s.document ? [{ label: t("employees.exit.orderScan"), value: <a className="font-medium text-brand-700 hover:underline" href={`/api/v1/documents/${s.document.id}?view=1`} target="_blank" rel="noopener">{s.document.fileName}</a> }] : []),
                ...(s.endDate ? [{ label: t("employees.exit.ended"), value: `${formatDate(s.endDate, locale)}${s.endNote ? ` — ${s.endNote}` : ""}` }] : []),
                { label: t("employees.exit.recordedBy"), value: `${s.createdByName} · ${formatDateTime(s.createdAt, locale)}` },
                ...(s.approvedAt ? [{ label: t("employees.exit.approvedOn"), value: formatDateTime(s.approvedAt, locale) }] : []),
              ]}
            />
          </CardBody>
        </Card>

        <div className="space-y-5 lg:col-span-2">
          {!exit && s.status === "APPROVED" && (
            <div className="flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{t("employees.exit.suspensionPay")}</p>
            </div>
          )}
          {dues && (
            <Card data-testid="dues-on-record">
              <CardHeader title={t("payroll.settlement.duesOnRecord")} description={t("payroll.settlement.duesOnRecordHelp")} icon={<HandCoins className="size-4.5" aria-hidden="true" />} actions={<Badge tone={dues.total ? "amber" : "green"}>{formatINR(dues.total)}</Badge>} />
              {dues.rows.length ? (
                <Table stack>
                  <THead>
                    <tr>
                      <Th>{t("payroll.settlement.item")}</Th>
                      <Th align="right">{t("payroll.settlement.amount")}</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {dues.rows.map((r) => (
                      <Tr key={r.key}>
                        <Td className="font-medium text-ink-900">
                          {locale === "hi" ? r.labelHi : r.label}
                          <span className="block text-xs font-normal text-ink-500">{r.note}</span>
                        </Td>
                        <Td label={t("payroll.settlement.amount")} align="right">{formatINR(r.amount)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <CardBody>
                  <p className="text-sm text-ink-500">{t("payroll.settlement.nothingOnRecord")}</p>
                </CardBody>
              )}
              {dues.gpfAdvanceLeft > 0 && (
                <CardBody className="border-t border-ink-100 py-3">
                  <p className="text-sm text-ink-600">{t("payroll.settlement.gpfAdvanceLeft", { amount: formatINR(dues.gpfAdvanceLeft) })}</p>
                </CardBody>
              )}
            </Card>
          )}
          {exit && s.status === "APPROVED" && !settlement && (
            <Card>
              <CardBody>
                <p className="text-sm text-ink-600">{t("payroll.settlement.noRights")}</p>
              </CardBody>
            </Card>
          )}
          {exit && s.status === "PENDING" && (
            <Card>
              <CardBody>
                <p className="text-sm text-ink-600">{t("payroll.settlement.afterApproval")}</p>
              </CardBody>
            </Card>
          )}
          {settlement && <Settlement id={s.id} v={settlement} t={t} locale={locale} />}
        </div>
      </div>
    </div>
  );
}

function Lines({ lines, t, locale, testId }: { lines: StatementLine[]; t: TFunction; locale: Locale; testId: string }) {
  if (!lines.length) return <CardBody className="py-4"><p className="text-sm text-ink-500">{t("payroll.settlement.nil")}</p></CardBody>;
  return (
    <Table stack>
      <THead>
        <tr>
          <Th>{t("payroll.settlement.item")}</Th>
          <Th align="right">{t("payroll.settlement.amount")}</Th>
        </tr>
      </THead>
      <tbody data-testid={testId}>
        {lines.map((l) => (
          <Tr key={l.key}>
            <Td className="font-medium text-ink-900">
              {locale === "hi" ? l.labelHi : l.label}
              {(l.note || l.noteHi) && <span className="block text-xs font-normal text-ink-500">{locale === "hi" ? (l.noteHi ?? l.note) : l.note}</span>}
            </Td>
            <Td label={t("payroll.settlement.amount")} align="right" className="whitespace-nowrap">
              {formatINR(l.amount)}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

function Settlement({ id, v, t, locale }: { id: string; v: SettlementView; t: TFunction; locale: Locale }) {
  const st = v.statement;
  const tot = st.totals;
  const dues = st.lines.filter((l) => l.kind === "DUE");
  const recoveries = st.lines.filter((l) => l.kind === "RECOVERY");
  return (
    <div className="space-y-5" data-testid="settlement">
      <Card>
        <CardHeader
          title={t("payroll.settlement.title")}
          description={v.frozen ? t("payroll.settlement.frozen", { date: formatDate(st.workedOn, locale) }) : t("payroll.settlement.live")}
          icon={<Scale className="size-4.5" aria-hidden="true" />}
          actions={<Badge tone={SETTLEMENT_TONE[v.status as keyof typeof SETTLEMENT_TONE]}>{tDynamic(t, `employees.exit.settlementStatus.${v.status}`)}</Badge>}
        />
        <CardBody className="space-y-3">
          {!st.lastDayPassed && v.status === "NONE" && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {t("payroll.settlement.lastDayAhead", { date: formatDate(st.lastDay, locale) })}
            </p>
          )}
          {v.status === "NONE" && st.waitFor.length > 0 && (
            <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="settlement-wait">
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {t("payroll.settlement.waitForTitle")}
              </p>
              <ul className="ml-6 mt-1 list-disc">
                {st.waitFor.map((w) => (
                  <li key={w.title}>{w.runId ? <Link className="font-medium underline" href={`/payroll/${w.runId}`}>{locale === "hi" ? w.titleHi : w.title}</Link> : locale === "hi" ? w.titleHi : w.title}</li>
                ))}
              </ul>
            </div>
          )}
          {st.pendingLoans.length > 0 && v.status === "NONE" && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {t("payroll.settlement.pendingLoans", { count: st.pendingLoans.length })}
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="settlement-totals">
            <StatTile label={t("payroll.settlement.totalDues")} value={formatINR(tot.dues)} icon={<Wallet className="size-5" aria-hidden="true" />} />
            <StatTile label={t("payroll.settlement.totalRecoveries")} value={formatINR(tot.recoveries)} tone="amber" icon={<HandCoins className="size-5" aria-hidden="true" />} />
            {tot.toRecover > 0 ? (
              <StatTile label={t("payroll.settlement.toRecover")} value={formatINR(tot.toRecover)} tone="red" icon={<Scale className="size-5" aria-hidden="true" />} hint={v.received ? t("payroll.settlement.receivedSoFar", { amount: formatINR(v.received) }) : undefined} />
            ) : (
              <StatTile label={t("payroll.settlement.netPayable")} value={formatINR(tot.payable)} tone="blue" icon={<Scale className="size-5" aria-hidden="true" />} />
            )}
          </div>
          {(v.canMakeBill || v.canRecordReceipt || v.run) && (
            <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-3">
              {v.canMakeBill && <MakeBillButton id={id} />}
              {v.canRecordReceipt && v.stillToRecover > 0 && <ReceiptDialog id={id} left={v.stillToRecover} />}
              {v.run && (
                <Link href={`/payroll/${v.run.id}`} className="inline-flex items-center gap-2 text-sm font-medium text-brand-700 hover:underline">
                  {locale === "hi" ? v.run.titleHi : v.run.title}
                  <Badge tone={STATUS_TONE[v.run.status as keyof typeof STATUS_TONE]}>{tDynamic(t, `payroll.status.${v.run.status}`)}</Badge>
                </Link>
              )}
            </div>
          )}
          {v.status === "APPROVED" && tot.payable > 0 && !v.run && !v.canMakeBill && <p className="text-sm text-ink-600">{t("payroll.settlement.billByPayroll")}</p>}
          {v.status === "SETTLED" && v.settledAt && <p className="text-sm font-medium text-brand-800">{t("payroll.settlement.settledOn", { date: formatDateTime(v.settledAt, locale) })}</p>}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("payroll.settlement.dues")} actions={<span className="text-sm font-semibold text-ink-900">{formatINR(tot.dues)}</span>} />
          <Lines lines={dues} t={t} locale={locale} testId="settlement-dues" />
        </Card>
        <Card>
          <CardHeader title={t("payroll.settlement.recoveries")} actions={<span className="text-sm font-semibold text-ink-900">{formatINR(tot.recoveries)}</span>} />
          <Lines lines={recoveries} t={t} locale={locale} testId="settlement-recoveries" />
        </Card>
      </div>

      {(st.leave || st.gpf || st.nps) && (
        <Card>
          <CardHeader title={t("payroll.settlement.working")} icon={<Landmark className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                ...(st.leave
                  ? [
                      { label: t("payroll.settlement.elBalance"), value: t("payroll.settlement.elBalanceValue", { balance: st.leave.balance, notEarned: st.leave.notEarned }) },
                      { label: t("payroll.settlement.leaveRule"), value: `${tDynamic(t, `payroll.settlement.rule.${st.kind}`)} → ${t("payroll.settlement.daysValue", { days: st.leave.ruleDays })}` },
                      ...(st.leave.changed ? [{ label: t("payroll.settlement.leaveChanged"), value: `${t("payroll.settlement.daysValue", { days: st.leave.days })} — ${st.leave.note ?? ""}` }] : []),
                      { label: t("payroll.settlement.payWithDa"), value: t("payroll.settlement.payWithDaValue", { pay: formatINR(st.leave.pay), da: st.leave.daPercent, withDa: formatINR(st.leave.withDa) }) },
                    ]
                  : []),
                ...(st.gpf ? [{ label: t("payroll.settlement.gpf"), value: t("payroll.settlement.gpfValue", { total: formatINR(st.gpf.total), balance: formatINR(st.gpf.balance), interest: formatINR(st.gpf.interest) }) + (st.gpf.advanceLeft ? ` ${t("payroll.settlement.gpfAdvanceLeft", { amount: formatINR(st.gpf.advanceLeft) })}` : "") }] : []),
                ...(st.nps ? [{ label: t("payroll.settlement.nps"), value: t("payroll.settlement.npsValue") }] : []),
              ]}
            />
          </CardBody>
        </Card>
      )}

      {v.canEdit && (
        <Card>
          <CardHeader title={t("payroll.settlement.entries")} description={t("payroll.settlement.entriesHelp")} />
          <CardBody>
            <SettlementEditor id={id} inputs={v.inputs} ruleDays={st.leave?.ruleDays ?? 0} hasLeave={Boolean(st.leave)} withheld={st.withheld} canSubmit={v.canSubmit} />
          </CardBody>
        </Card>
      )}

      {v.receipts.length > 0 && (
        <Card>
          <CardHeader title={t("payroll.settlement.receipts")} actions={<span className="text-sm font-semibold text-ink-900">{formatINR(v.received)}</span>} />
          <Table stack>
            <THead>
              <tr>
                <Th>{t("payroll.settlement.receiptNo")}</Th>
                <Th>{t("payroll.settlement.receiptDate")}</Th>
                <Th>{t("payroll.settlement.recordedBy")}</Th>
                <Th align="right">{t("payroll.settlement.amount")}</Th>
              </tr>
            </THead>
            <tbody>
              {v.receipts.map((r) => (
                <Tr key={`${r.receiptNo}-${r.at}`}>
                  <Td className="font-medium text-ink-900">{r.receiptNo}</Td>
                  <Td label={t("payroll.settlement.receiptDate")}>{formatDate(r.date, locale)}</Td>
                  <Td label={t("payroll.settlement.recordedBy")}>{r.byName}</Td>
                  <Td label={t("payroll.settlement.amount")} align="right">{formatINR(r.amount)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
