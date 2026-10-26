import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Download, Grid3x3, Landmark, Layers, Percent } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { can } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDate, todayIST } from "@/lib/dates";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { levelOrder } from "@/modules/payroll/compute";
import { rulesOverview } from "@/modules/payroll/rates";
import { dueRulesScreen, taxRulesScreen } from "@/modules/statutory/rules";
import { HeadsTable } from "./heads-table";
import { MatrixUpload } from "./matrix-upload";
import { DueRuleButton } from "./due-rule-button";
import { RateButton } from "./rate-button";
import { TaxRuleButton } from "./tax-rule-button";

export const metadata: Metadata = { title: "Rates and rules" };

const TABS = ["rates", "heads", "matrix", "tax", "dues"] as const;
type Tab = (typeof TABS)[number];

/** S-81: the dated tables the pay engine reads. HR & Accounts propose, an Admin approves. */
export default async function RatesPage({ searchParams }: { searchParams: Promise<{ tab?: string; all?: string }> }) {
  const actor = await requireActor();
  if (!can(actor, "rates_rules", "view") && !can(actor, "payroll", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "rates";
  const [data, taxRules, dueRules] = await Promise.all([rulesOverview(actor), tab === "tax" ? taxRulesScreen(actor) : null, tab === "dues" ? dueRulesScreen(actor) : null]);
  const today = todayIST();
  const pendingKeys = new Set(data.pending.map((p) => `${p.kind}|${p.entityId}`));
  const fmt = (unit: string, v: number) => (unit === "PERCENT" ? t("rates.percent", { value: v }) : t("rates.rupees", { value: v.toLocaleString("en-IN") }));

  return (
    <div>
      <PageHeader title={t("rates.title")} description={t("rates.subtitle")} />
      <LinkTabs className="mb-5" active={tab} tabs={TABS.map((k) => ({ key: k, label: t(`rates.tabs.${k}`), href: `/admin/rates?tab=${k}` }))} />

      {tab === "rates" &&
        (["PAY", "ALLOWANCE", "STATUTORY"] as const).map((group) => (
          <Card key={group} className="mb-5">
            <CardHeader title={t(`rates.groups.${group}`)} icon={<Percent className="size-4.5" aria-hidden="true" />} />
            <Table stack>
              <THead>
                <tr>
                  <Th className="w-[36%]">{t("rates.rate")}</Th>
                  <Th align="right" className="w-[12%]">{t("rates.current")}</Th>
                  <Th className="w-[20%]">{t("rates.from")}</Th>
                  <Th className="w-[18%]">{t("rates.history")}</Th>
                  <Th />
                </tr>
              </THead>
              <tbody>
                {data.rates
                  .filter((r) => r.group === group)
                  .map((r) => {
                    const current = r.history.find((h) => h.effectiveFrom <= today);
                    const upcoming = r.history.filter((h) => h.effectiveFrom > today);
                    const earlier = r.history.filter((h) => h !== current && h.effectiveFrom <= today);
                    const pending = pendingKeys.has(`rate.change|${r.key}`);
                    return (
                      <Tr key={r.key}>
                        <Td>
                          <span className="font-medium text-ink-900">{locale === "hi" ? r.nameHi : r.name}</span>
                          <span className="block text-xs text-ink-400">{r.key}</span>
                        </Td>
                        <Td label={t("rates.current")} align="right" className="text-base font-semibold text-ink-950">
                          {current ? fmt(r.unit, current.value) : <span className="text-sm font-normal text-ink-400">{t("rates.noValue")}</span>}
                        </Td>
                        <Td label={t("rates.from")}>
                          {current ? formatDate(current.effectiveFrom, locale) : "—"}
                          {current?.note && <span className="block text-xs text-ink-500">{current.note}</span>}
                          {upcoming.map((u) => (
                            <span key={u.effectiveFrom} className="mt-1 block text-xs font-medium text-sky-700">
                              {fmt(r.unit, u.value)} · {formatDate(u.effectiveFrom, locale)}
                            </span>
                          ))}
                        </Td>
                        <Td label={t("rates.history")} className="text-xs text-ink-500">
                          {earlier.length ? earlier.map((h) => `${fmt(r.unit, h.value)} (${formatDate(h.effectiveFrom, locale)})`).join(" · ") : "—"}
                        </Td>
                        <Td align="right" actions>
                          {pending ? (
                            <Badge tone="amber">{t("rates.pending")}</Badge>
                          ) : (
                            data.canPropose && <RateButton rateKey={r.key} name={locale === "hi" ? r.nameHi : r.name} unit={r.unit} current={current?.value ?? null} />
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
              </tbody>
            </Table>
          </Card>
        ))}

      {taxRules &&
        taxRules.years.map((y) => (
          <Card key={y.fy} className="mb-5">
            <CardHeader title={t("statutory.rules.taxTitle", { fy: y.fy })} description={t("statutory.rules.taxHelp")} icon={<Landmark className="size-4.5" aria-hidden="true" />} />
            <CardBody className="grid gap-5 lg:grid-cols-2">
              {y.regimes.map((r) => (
                <div key={r.regime} className="rounded-2xl border border-ink-200 p-4" data-testid={`tax-${y.fy}-${r.regime}`}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-ink-900">
                      {t(`statutory.tax.regimes.${r.regime}`)}
                      {!r.saved && <span className="ml-2 text-xs font-normal text-ink-500">{t("statutory.rules.notSaved")}</span>}
                    </p>
                    {r.waiting ? <Badge tone="amber">{t("rates.pending")}</Badge> : taxRules.canPropose && <TaxRuleButton fy={y.fy} regime={r.regime} rules={r.rules} />}
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {r.rules.slabs.map((s, i) => (
                        <tr key={i} className="border-b border-ink-100 last:border-0">
                          <td className="py-1 text-ink-600">
                            {i === 0 ? "₹0" : `₹${r.rules.slabs[i - 1].upTo!.toLocaleString("en-IN")}`} – {s.upTo === null ? t("statutory.rules.above") : `₹${s.upTo.toLocaleString("en-IN")}`}
                          </td>
                          <td className="tabular py-1 text-right font-medium text-ink-900">{s.rate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <dl className="mt-3 grid gap-1 text-sm">
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-600">{t("statutory.rules.standardDeduction")}</dt>
                      <dd className="tabular">₹{r.rules.standardDeduction.toLocaleString("en-IN")}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-600">{t("statutory.rules.rebate")}</dt>
                      <dd className="tabular text-right">{t("statutory.rules.rebateText", { max: `₹${r.rules.rebateMax.toLocaleString("en-IN")}`, limit: `₹${r.rules.rebateIncomeLimit.toLocaleString("en-IN")}` })}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-ink-600">{t("statutory.rules.cess")}</dt>
                      <dd className="tabular">{r.rules.cessPercent}%</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </CardBody>
          </Card>
        ))}

      {dueRules && (
        <Card>
          <CardHeader title={t("statutory.rules.duesTitle")} description={t("statutory.rules.duesHelp")} icon={<CalendarClock className="size-4.5" aria-hidden="true" />} />
          <Table stack>
            <THead>
              <tr>
                <Th>{t("statutory.calendar.what")}</Th>
                <Th>{t("statutory.rules.when")}</Th>
                <Th />
              </tr>
            </THead>
            <tbody>
              {dueRules.rules.map((r) => (
                <Tr key={r.code}>
                  <Td>
                    <span className="font-medium text-ink-900">{locale === "hi" ? r.nameHi : r.name}</span>
                    <span className="block text-xs text-ink-400">{r.code}</span>
                  </Td>
                  <Td label={t("statutory.rules.when")}>
                    {r.kind === "MONTHLY" ? t("statutory.rules.whenMonthly", { day: r.day }) : r.kind === "AFTER_PAY" ? t("statutory.rules.whenAfterPay", { day: r.day }) : r.dates.join(", ")}
                  </Td>
                  <Td align="right" actions>
                    {r.waiting ? <Badge tone="amber">{t("rates.pending")}</Badge> : dueRules.canPropose && <DueRuleButton code={r.code} name={locale === "hi" ? r.nameHi : r.name} kind={r.kind} day={r.day} dates={r.dates} />}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {tab === "heads" && (
        <Card>
          <CardHeader title={t("rates.tabs.heads")} icon={<Layers className="size-4.5" aria-hidden="true" />} />
          <HeadsTable
            heads={data.heads.map((h) => ({ code: h.code, name: h.name, nameHi: h.nameHi, kind: h.kind, calc: h.calc, value: Number(h.value), postCodes: h.postCodes, prorate: h.prorate, taxable: h.taxable, accountHead: h.accountHead, isActive: h.isActive, version: h.version }))}
            pending={data.pending.filter((p) => p.kind === "payhead.change").map((p) => p.entityId ?? "")}
            canPropose={data.canPropose}
          />
        </Card>
      )}

      {tab === "matrix" && (
        <>
          {data.matrices.map((m, i) => {
            const levels = Object.keys(m.levels).sort(levelOrder);
            const width = Math.max(...levels.map((l) => m.levels[l].length));
            const show = sp.all === "1" ? width : Math.min(width, 10);
            return (
              <Card key={m.id} className={cn("mb-5", i > 0 && "opacity-90")}>
                <CardHeader
                  title={m.name}
                  description={`${t("rates.matrix.inForce", { date: formatDate(m.effectiveFrom, locale) })} · ${t("rates.matrix.levels", { count: levels.length })}`}
                  icon={<Grid3x3 className="size-4.5" aria-hidden="true" />}
                  actions={
                    i === 0 &&
                    width > show && (
                      <Link href="/admin/rates?tab=matrix&all=1" className="text-sm font-medium text-brand-700 hover:underline">
                        {t("rates.matrix.showAll")}
                      </Link>
                    )
                  }
                />
                {i === 0 && (
                  <div className="scrollbar-thin relative overflow-x-auto">
                    <table className="w-full min-w-max text-sm">
                      <thead>
                        <tr className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                          <th className="sticky left-0 bg-ink-50 px-4 py-2 sm:pl-6">{t("rates.matrix.level")}</th>
                          {Array.from({ length: show }, (_, c) => (
                            <th key={c} className="px-3 py-2 text-right">
                              {t("rates.matrix.cell", { n: c + 1 })}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {levels.map((l) => (
                          <tr key={l} className="border-b border-ink-100">
                            <th scope="row" className="sticky left-0 bg-white px-4 py-2 text-left font-semibold text-ink-900 sm:pl-6">
                              {l}
                            </th>
                            {Array.from({ length: show }, (_, c) => (
                              <td key={c} className="tabular px-3 py-2 text-right text-ink-700">
                                {m.levels[l][c]?.toLocaleString("en-IN") ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            );
          })}
          <Card>
            <CardHeader title={t("rates.matrix.add")} description={t("rates.matrix.addHelp")} />
            <CardBody className="space-y-4">
              <a href="/api/v1/rates/matrix-template" download className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
                <Download className="size-4" aria-hidden="true" /> {t("rates.matrix.template")}
              </a>
              {data.canPropose && <MatrixUpload pending={data.pending.some((p) => p.kind === "matrix.add")} />}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

