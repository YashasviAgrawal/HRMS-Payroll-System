import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, BadgeCheck, Banknote, Briefcase, FileText, History, Landmark, Users } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { can, canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDate, formatMonth } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { pensionerProfile } from "@/modules/pension/pensioners";
import { PENSION_TYPE_LABEL } from "@/modules/pension/rules";
import { LC_TONE } from "../../_components/pension-tabs";
import { AddCertificateButton, DeathButton, EditPensionerButton } from "../../_components/pensioner-actions";

export const metadata: Metadata = { title: "Pensioner" };

/** S-60 profile: the pension now, the payee and bank, the service it comes from, life certificates and slips. */
export default async function PensionerPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "pension", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const { id } = await params;
  const d = await pensionerProfile(actor, id);
  const p = d.pensioner;
  const hi = locale === "hi";
  const name = hi && p.payeeHi ? p.payeeHi : p.payee;
  const stopped = p.status === "STOPPED";

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: t("pension.title"), href: "/pension" }, { label: t("pension.tabs.pensioners"), href: "/pension/pensioners" }, { label: p.ppoNumber }]}
        title={name}
        description={`${p.ppoNumber} · ${p.typeLabel[hi ? 1 : 0]} · ${t("pension.pensioners.age", { age: p.age })}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={stopped ? "red" : "green"} dot>
              {tDynamic(t, `pension.pensioners.status.${p.status}`)}
            </Badge>
            {d.can.manage && !stopped && (
              <>
                <EditPensionerButton p={{ id: p.id, payee: p.payee, payeeHi: p.payeeHi, mobile: p.mobile, email: p.email, ifsc: p.bank.ifsc, bankName: p.bank.name, bankLast4: p.bank.last4, fma: p.fma, basic: p.basic, reduced: p.reduced, commuted: p.commuted, commutationDate: p.commutationDate }} />
                <DeathButton pensionerId={p.id} family={d.family} />
              </>
            )}
          </div>
        }
      />

      {stopped && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{t("pension.profile.stopped", { date: formatDate(p.endDate, locale), reason: p.endReason ?? "" })}</p>
        </div>
      )}
      {d.pending.length > 0 && (
        <div role="status" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">{t("pension.profile.waiting")}</p>
          <ul className="mt-1 list-disc pl-5">
            {d.pending.map((task) => (
              <li key={task.id}>
                <Link href={`/approvals/${task.id}`} className="underline-offset-2 hover:underline">
                  {hi && task.titleHi ? task.titleHi : task.title}
                </Link>{" "}
                — {task.makerName}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-testid="pension-now">
          <CardHeader title={t("pension.profile.pensionNow")} icon={<Landmark className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <DescriptionList
              columns={2}
              items={[
                { label: t("pension.fields.basic"), value: <span className="tabular text-lg font-semibold text-ink-950">{formatINR(p.basic)}</span> },
                ...(p.reduced ? [{ label: t("pension.fields.reduced"), value: t("pension.profile.reducedFrom", { amount: formatINR(p.reduced.amount), date: formatDate(p.reduced.from, locale) }) }] : []),
                { label: t("pension.profile.addl"), value: p.addlPct ? t("pension.profile.addlNow", { pct: p.addlPct, age: p.age }) : t("pension.profile.addlFrom80") },
                { label: t("pension.profile.dr"), value: `${p.drRate}%` },
                { label: t("pension.fields.fma"), value: p.fma ? t("common.yes") : t("pension.profile.noFma") },
                {
                  label: t("pension.fields.commuted"),
                  value: p.commuted ? (p.restored ? t("pension.profile.restored", { amount: formatINR(p.commuted), date: formatDate(p.restoredOn, locale) }) : t("pension.profile.commutedTill", { amount: formatINR(p.commuted), date: formatDate(p.restoredOn, locale) })) : "—",
                },
                ...(p.commutationLumpSum ? [{ label: t("pension.profile.lumpSum"), value: formatINR(p.commutationLumpSum) }] : []),
                { label: t("pension.profile.since"), value: formatDate(p.startDate, locale) },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("pension.profile.payee")} icon={<Banknote className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                { label: t("pension.fields.relation"), value: tDynamic(t, `pension.relation.${p.relation}`) },
                { label: t("pension.fields.dob"), value: formatDate(p.payeeDob, locale) },
                { label: t("pension.fields.mobile"), value: p.mobile ?? "—" },
                { label: t("pension.fields.account"), value: p.bank.last4 ? `••••${p.bank.last4} · ${p.bank.ifsc ?? ""}` : "—" },
                ...(p.bank.name ? [{ label: t("pension.fields.bankName"), value: p.bank.name }] : []),
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-testid="life-certificates">
          <CardHeader
            title={t("pension.lc.title")}
            icon={<BadgeCheck className="size-4.5" aria-hidden="true" />}
            description={stopped ? undefined : t("pension.lc.statusLine", { until: formatDate(d.lc.validTill, locale), hold: formatDate(d.lc.holdFrom, locale) })}
            actions={
              <div className="flex items-center gap-2">
                {!stopped && (
                  <Badge tone={LC_TONE[d.lc.state]} dot>
                    {tDynamic(t, `pension.lc.state.${d.lc.state}`)}
                  </Badge>
                )}
                {d.can.manage && !stopped && <AddCertificateButton pensionerId={p.id} />}
              </div>
            }
          />
          {d.certificates.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-600">{t("pension.lc.none")}</p>
            </CardBody>
          ) : (
            <Table stack>
              <THead>
                <tr>
                  <Th>{t("pension.lc.date")}</Th>
                  <Th>{t("pension.lc.source")}</Th>
                  <Th>{t("pension.lc.statusCol")}</Th>
                  <Th>{t("pension.lc.scan")}</Th>
                </tr>
              </THead>
              <tbody>
                {d.certificates.map((c) => (
                  <Tr key={c.id}>
                    <Td className="font-medium text-ink-900">{formatDate(c.certifiedOn, locale)}</Td>
                    <Td label={t("pension.lc.source")}>
                      {tDynamic(t, `pension.lc.sources.${c.source}`)}
                      {c.jpId && <span className="block text-xs text-ink-500">{c.jpId}</span>}
                    </Td>
                    <Td label={t("pension.lc.statusCol")}>
                      <Badge tone={c.status === "VERIFIED" ? "green" : c.status === "SUBMITTED" ? "amber" : "red"}>{tDynamic(t, `pension.lc.status.${c.status}`)}</Badge>
                      {c.note && <span className="block text-xs text-ink-500">{c.note}</span>}
                    </Td>
                    <Td label={t("pension.lc.scan")}>
                      {c.hasFile ? (
                        <a href={`/api/v1/pension/life-certificates/${c.id}/file`} target="_blank" rel="noopener" className="text-sm font-medium text-brand-700 hover:underline">
                          {t("pension.lc.open")}
                        </a>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title={t("pension.profile.service")} icon={<Briefcase className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                {
                  label: t("pension.profile.of"),
                  value: can(actor, "employee_master", "view") ? (
                    <Link href={`/employees/${d.employee.id}`} className="font-medium text-brand-700 hover:underline">
                      {hi && d.employee.nameHi ? d.employee.nameHi : d.employee.name}
                    </Link>
                  ) : (
                    d.employee.name
                  ),
                },
                { label: t("pension.profile.code"), value: d.employee.code ?? "—" },
                { label: t("pension.profile.post"), value: `${hi ? d.employee.post.nameHi : d.employee.post.name} — ${hi ? d.employee.section.nameHi : d.employee.section.name}` },
                { label: t("pension.profile.joined"), value: formatDate(d.employee.dateOfJoining, locale) },
                { label: t("pension.profile.lastDay"), value: formatDate(d.employee.lastDay, locale) },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title={t("pension.profile.slips")} icon={<FileText className="size-4.5" aria-hidden="true" />} />
        {d.slips.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("pension.profile.noSlips")}</p>
          </CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("payroll.month")}</Th>
                <Th align="right">{t("payroll.gross")}</Th>
                <Th align="right">{t("payroll.deductions")}</Th>
                <Th align="right">{t("pension.bills.net")}</Th>
                <Th>{t("payroll.columns.status")}</Th>
                <Th>{t("pension.profile.pdf")}</Th>
              </tr>
            </THead>
            <tbody>
              {d.slips.map((s) => (
                <Tr key={s.id}>
                  <Td className="font-medium text-ink-900">
                    {formatMonth(s.month, locale)}
                    {s.kind === "SUPPLEMENTARY" && <span className="block text-xs text-violet-700">{t("pension.profile.supplementary")}</span>}
                    {s.catchUp.length > 0 && <span className="block text-xs text-ink-500">{t("pension.profile.withMonths", { months: s.catchUp.map((m) => formatMonth(m, locale)).join(", ") })}</span>}
                  </Td>
                  <Td label={t("payroll.gross")} align="right">
                    {formatINR(s.gross)}
                  </Td>
                  <Td label={t("payroll.deductions")} align="right">
                    {formatINR(s.deductions)}
                  </Td>
                  <Td label={t("pension.bills.net")} align="right" className="font-semibold text-ink-950">
                    {formatINR(s.net)}
                  </Td>
                  <Td label={t("payroll.columns.status")}>{s.status === "WITHHELD" ? <Badge tone="amber">{t("payroll.withheld")}</Badge> : <Badge tone="green">{tDynamic(t, `payroll.status.${s.runStatus}`)}</Badge>}</Td>
                  <Td label={t("pension.profile.pdf")}>
                    <a href={`/api/v1/payslips/${s.id}/pdf?lang=${locale}`} target="_blank" rel="noopener" className="text-sm font-medium text-brand-700 hover:underline">
                      {t("common.download")}
                    </a>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("pension.profile.family")} description={t("pension.profile.familyHelp")} icon={<Users className="size-4.5" aria-hidden="true" />} />
          {d.family.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-600">{t("pension.profile.noFamily")}</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-ink-100">
              {d.family.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm sm:px-6">
                  <span className="font-medium text-ink-900">{m.name}</span>
                  <span className="text-ink-500">
                    {tDynamic(t, `pension.relation.${m.relation}`)}
                    {m.dob && ` · ${formatDate(m.dob, locale)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t("pension.profile.history")} icon={<History className="size-4.5" aria-hidden="true" />} />
          <CardBody className="space-y-3 text-sm">
            {d.history.length === 0 && d.recoveries.length === 0 && <p className="text-ink-600">{t("pension.profile.noHistory")}</p>}
            {d.history.map((h) => (
              <p key={h.id}>
                <Link href={`/pension/pensioners/${h.id}`} className="font-medium text-brand-700 hover:underline">
                  {h.ppoNumber}
                </Link>{" "}
                — {hi && h.payeeNameHi ? h.payeeNameHi : h.payeeName} ({PENSION_TYPE_LABEL[h.type]?.[hi ? 1 : 0]}), {formatDate(h.startDate, locale)} – {h.endDate ? formatDate(h.endDate, locale) : t("pension.profile.running")}
                {h.endReason && <span className="block text-xs text-ink-500">{h.endReason}</span>}
              </p>
            ))}
            {d.recoveries.map((r) => (
              <p key={r.id} className="text-amber-800">
                {t("pension.profile.recovery", { amount: formatINR(r.amount), from: formatMonth(r.fromMonth, locale), to: r.toMonth ? formatMonth(r.toMonth, locale) : "…" })}
                {r.note && <span className="block text-xs text-ink-500">{r.note}</span>}
              </p>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
