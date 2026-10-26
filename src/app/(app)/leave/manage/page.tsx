import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, PenLine, Scale, Search } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink } from "@/components/ui/row-link";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, THead } from "@/components/ui/table";
import { can, canAll, scopeFor } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { addDays, formatDate, fromISODate, todayIST, toISODate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { fullName } from "@/modules/employees/present";
import { leaveRules } from "@/modules/leave/balance";
import { balancesOverview, canEnterLeave, listApplications } from "@/modules/leave/service";
import { AreaSwitch } from "../../attendance/_components/area-switch";
import { LEAVE_TONE } from "../_components/tones";
import { EnterPanel } from "./enter-panel";
import { OpeningPanel } from "./opening-panel";
import { RulesTable } from "./rules-table";

export const metadata: Metadata = { title: "Leave" };

const TABS = ["applications", "balances", "enter", "opening", "rules"] as const;
type Tab = (typeof TABS)[number];
const fmt = (n: number | null) => (n === null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));

export default async function ManageLeavePage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; q?: string }> }) {
  const actor = await requireActor();
  if (scopeFor(actor, "leave", "view") !== "all") return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const hr = canEnterLeave(actor);
  const tabs = TABS.filter((k) => (k !== "enter" && k !== "opening") || hr);
  const tab: Tab = (tabs as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "applications";
  const content = tab === "balances" ? await balancesTab() : tab === "enter" ? await enterTab() : tab === "opening" ? openingTab() : tab === "rules" ? await rulesTab() : await applicationsTab();

  return (
    <div>
      <PageHeader title={t("leave.title")} description={t("leave.manage.subtitle")} />
      {can(actor, "attendance", "view") && <AreaSwitch active="leave" labels={{ attendance: t("attendance.title"), leave: t("leave.title") }} />}
      <LinkTabs className="mb-5" active={tab} tabs={tabs.map((k) => ({ key: k, label: t(`leave.manage.tabs.${k}`), href: `/leave/manage?tab=${k}` }))} />
      {content}
    </div>
  );

  async function applicationsTab() {
    const status = sp.status === "APPROVED" || sp.status === "ALL" ? sp.status : "PENDING";
    const rows = await listApplications(actor, { status });
    return (
      <Card>
        <CardHeader
          title={t("leave.manage.tabs.applications")}
          icon={<ClipboardList className="size-4.5" aria-hidden="true" />}
          actions={
            <div className="flex gap-1 rounded-xl bg-ink-100 p-1" role="group">
              {(["PENDING", "APPROVED", "ALL"] as const).map((s) => (
                <Link key={s} href={`/leave/manage?tab=applications&status=${s}`} aria-current={status === s ? "page" : undefined} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", status === s ? "bg-white text-brand-800 shadow-card" : "text-ink-600 hover:text-ink-900")}>
                  {tDynamic(t, `leave.manage.filter.${s}`)}
                </Link>
              ))}
            </div>
          }
        />
        {rows.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-600">{t("leave.manage.none")}</p>
          </CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("employees.columns.employee")}</Th>
                <Th>{t("leave.type")}</Th>
                <Th>{t("leave.application.dates")}</Th>
                <Th align="right">{t("leave.application.days")}</Th>
                <Th>{t("common.status")}</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((a) => (
                <RowLink key={a.id} href={`/leave/applications/${a.id}`}>
                  <Td>
                    <p className="font-medium text-ink-900">{(locale === "hi" && a.employee.nameHi) || fullName(a.employee)}</p>
                    <p className="text-xs text-ink-500">
                      {a.employee.employeeCode} · {locale === "hi" ? a.employee.section.nameHi : a.employee.section.name}
                    </p>
                  </Td>
                  <Td label={t("leave.type")}>
                    {a.leaveCode}
                    {a.onBehalf && <span className="block text-xs text-ink-500">{t("leave.application.enteredByHr")}</span>}
                  </Td>
                  <Td label={t("leave.application.dates")} className="whitespace-nowrap">
                    {formatDate(toISODate(a.fromDate), locale)}
                    {a.toDate.getTime() !== a.fromDate.getTime() && ` – ${formatDate(toISODate(a.toDate), locale)}`}
                  </Td>
                  <Td align="right" label={t("leave.application.days")}>{fmt(Number(a.days))}</Td>
                  <Td label={t("common.status")}>
                    <Badge tone={LEAVE_TONE[a.status]} dot>
                      {tDynamic(t, `leave.status.${a.status}`)}
                    </Badge>
                  </Td>
                </RowLink>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    );
  }

  async function balancesTab() {
    const rows = await balancesOverview(actor, sp.q);
    return (
      <Card>
        <CardHeader
          title={t("leave.manage.tabs.balances")}
          icon={<Scale className="size-4.5" aria-hidden="true" />}
          actions={
            <form action="/leave/manage" className="flex items-center gap-2" role="search">
              <input type="hidden" name="tab" value="balances" />
              <label htmlFor="leave-search" className="sr-only">
                {t("leave.manage.search")}
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
                <input id="leave-search" name="q" defaultValue={sp.q ?? ""} placeholder={t("leave.manage.searchPlaceholder")} className="h-9 w-56 rounded-lg border border-ink-200 bg-white pl-9 pr-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/12" />
              </div>
            </form>
          }
        />
        <Table stack>
          <THead>
            <tr>
              <Th>{t("employees.columns.employee")}</Th>
              <Th align="right">CL</Th>
              <Th align="right">EL</Th>
              <Th align="right">HPL</Th>
              <Th>{t("leave.manage.filter.PENDING")}</Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <RowLink key={r.id} href={`/leave/ledger/${r.id}`}>
                <Td>
                  <p className="font-medium text-ink-900">{(locale === "hi" && r.nameHi) || fullName(r)}</p>
                  <p className="text-xs text-ink-500">
                    {r.employeeCode} · {locale === "hi" ? r.section.nameHi : r.section.name}
                  </p>
                </Td>
                <Td align="right" label="CL">{fmt(r.balances.CL)}</Td>
                <Td align="right" label="EL" className="font-semibold">{fmt(r.balances.EL)}</Td>
                <Td align="right" label="HPL">{fmt(r.balances.HPL)}</Td>
                <Td label={t("leave.manage.filter.PENDING")}>{r.waiting > 0 ? <Badge tone="amber">{r.waiting}</Badge> : "—"}</Td>
              </RowLink>
            ))}
          </tbody>
        </Table>
      </Card>
    );
  }

  async function enterTab() {
    const today = todayIST();
    const [staff, rules, rh] = await Promise.all([
      db.employee.findMany({ where: { boardId: actor.boardId, employeeCode: { not: null }, status: "ACTIVE" }, orderBy: { employeeCode: "asc" }, select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true } }),
      leaveRules(actor.boardId),
      db.holiday.findMany({ where: { boardId: actor.boardId, kind: "RESTRICTED", date: { gte: fromISODate(addDays(today, -60)), lte: fromISODate(addDays(today, 365)) } }, orderBy: { date: "asc" } }),
    ]);
    return (
      <Card>
        <CardHeader title={t("leave.enter.title")} description={t("leave.enter.hint")} icon={<PenLine className="size-4.5" aria-hidden="true" />} />
        <CardBody>
          <EnterPanel
            today={today}
            staff={staff.map((s) => ({ id: s.id, label: `${s.employeeCode} · ${fullName(s)}` }))}
            types={rules.filter((r) => r.isActive).map((r) => ({ code: r.code, name: locale === "hi" ? r.nameHi : r.name, available: null, creditMode: r.creditMode }))}
            rules={Object.fromEntries(rules.map((r) => [r.code, { halfDayAllowed: r.halfDayAllowed, needsCertificate: false, restrictedOnly: r.restrictedOnly }]))}
            restrictedHolidays={rh.map((h) => ({ date: toISODate(h.date), name: locale === "hi" ? h.nameHi : h.name }))}
          />
        </CardBody>
      </Card>
    );
  }

  function openingTab() {
    return <OpeningPanel defaultAsOn={`${Number(todayIST().slice(0, 4)) - 1}-12-31`} />;
  }

  async function rulesTab() {
    const [rules, pending] = await Promise.all([leaveRules(actor.boardId), db.approvalTask.findMany({ where: { boardId: actor.boardId, kind: "leave.rule", status: "PENDING" }, select: { entityId: true } })]);
    return (
      <Card>
        <CardHeader title={t("leave.rules.title")} description={t("leave.rules.hint")} icon={<Scale className="size-4.5" aria-hidden="true" />} />
        <RulesTable rows={rules} pending={pending.map((p) => p.entityId ?? "")} canPropose={canAll(actor, "rates_rules", "create")} />
      </Card>
    );
  }
}
