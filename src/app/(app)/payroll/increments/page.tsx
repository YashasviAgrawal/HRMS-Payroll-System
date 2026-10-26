import type { Metadata } from "next";
import Link from "next/link";
import { History, TrendingUp } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDate, toISODate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { fullName } from "@/modules/employees/present";
import { levelOrder, matrixOn } from "@/modules/payroll/compute";
import { canPreparePay, incrementDueList } from "@/modules/payroll/increments";
import { PayrollTabs } from "../_components/payroll-tabs";
import { FixationForm } from "./fixation-form";
import { IncrementList } from "./increment-list";

export const metadata: Metadata = { title: "Increments and fixation" };

/** S-41: the 1 January / 1 July increment due list (PR-06) and pay fixation on promotion or MACP (PR-07). */
export default async function IncrementsPage({ searchParams }: { searchParams: Promise<{ tab?: string; date?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "payroll", "view") && !canAll(actor, "service_book", "create")) return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const tab = sp.tab === "fixation" ? "fixation" : "due";

  return (
    <div>
      <PageHeader title={t("payroll.title")} description={t("payroll.increments.subtitle")} />
      <PayrollTabs active="increments" principal={actor} t={t} />
      <LinkTabs
        className="mb-5"
        active={tab}
        tabs={[
          { key: "due", label: t("payroll.increments.tab"), href: "/payroll/increments" },
          { key: "fixation", label: t("payroll.fixation.tab"), href: "/payroll/increments?tab=fixation" },
        ]}
      />
      {tab === "due" ? await dueTab() : await fixationTab()}
    </div>
  );

  async function dueTab() {
    const data = await incrementDueList(actor, sp.date);
    const counts = { eligible: data.rows.filter((r) => r.status === "ELIGIBLE").length, done: data.rows.filter((r) => r.status === "DONE").length };
    return (
      <Card>
        <CardHeader
          title={t("payroll.increments.title", { date: formatDate(data.due, locale) })}
          description={t("payroll.increments.counts", { eligible: counts.eligible, done: counts.done, total: data.rows.length })}
          icon={<TrendingUp className="size-4.5" aria-hidden="true" />}
          actions={
            <div className="flex gap-1 rounded-xl bg-ink-100 p-1" role="group" aria-label={t("payroll.increments.dueDate")}>
              {data.dates.map((d) => (
                <Link key={d} href={`/payroll/increments?date=${d}`} aria-current={d === data.due ? "page" : undefined} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", d === data.due ? "bg-white text-brand-800 shadow-card" : "text-ink-600 hover:text-ink-900")}>
                  {formatDate(d, locale)}
                </Link>
              ))}
            </div>
          }
        />
        {data.arrearsLikely && (
          <CardBody className="border-b border-ink-100 bg-amber-50/40 py-3">
            <p className="text-sm text-amber-900">{t("payroll.increments.arrearsNote")}</p>
          </CardBody>
        )}
        <IncrementList
          due={data.due}
          rows={data.rows.map((r) => ({ ...r, name: locale === "hi" && r.nameHi ? r.nameHi : r.name, post: locale === "hi" ? r.postHi : r.post, section: locale === "hi" ? r.sectionHi : r.section, lastChange: formatDate(r.lastChange, locale) }))}
          canSend={data.canSend}
          tooEarly={canPreparePay(actor) && !data.canSend}
          sendAheadDays={data.sendAheadDays}
        />
      </Card>
    );
  }

  async function fixationTab() {
    const [employees, posts, matrix, recent] = await Promise.all([
      db.employee.findMany({ where: { boardId: actor.boardId, status: "ACTIVE", type: { in: ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION"] } }, select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, payLevel: true, payCell: true, post: { select: { name: true } } }, orderBy: { employeeCode: "asc" } }),
      db.post.findMany({ where: { boardId: actor.boardId, isActive: true }, select: { id: true, name: true, nameHi: true, payLevel: true }, orderBy: { name: "asc" } }),
      matrixOn(actor.boardId, toISODate(new Date()), db),
      db.payHistory.findMany({ where: { boardId: actor.boardId, reason: { in: ["PROMOTION", "MACP"] } }, include: { employee: { select: { employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    const levels = matrix ? Object.keys(matrix.levels as object).sort(levelOrder) : [];
    return (
      <div className="grid gap-5">
        <FixationForm
          employees={employees.map((e) => ({ id: e.id, label: `${e.employeeCode} · ${locale === "hi" && e.nameHi ? e.nameHi : fullName(e)} — L${e.payLevel ?? "?"} C${e.payCell ?? "?"}` }))}
          posts={posts.map((p) => ({ id: p.id, label: `${locale === "hi" ? p.nameHi : p.name} (L${p.payLevel})`, level: p.payLevel }))}
          levels={levels}
          canSend={canPreparePay(actor)}
        />
        <Card>
          <CardHeader title={t("payroll.fixation.recent")} icon={<History className="size-4.5" aria-hidden="true" />} />
          {recent.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-600">{t("payroll.fixation.none")}</p>
            </CardBody>
          ) : (
            <Table stack>
              <THead>
                <tr>
                  <Th>{t("payroll.columns.employee")}</Th>
                  <Th>{t("payroll.fixation.kind")}</Th>
                  <Th>{t("payroll.fixation.from")}</Th>
                  <Th>{t("payroll.fixation.newPay")}</Th>
                </tr>
              </THead>
              <tbody>
                {recent.map((h) => (
                  <Tr key={h.id}>
                    <Td>
                      <span className="font-medium text-ink-900">{locale === "hi" && h.employee.nameHi ? h.employee.nameHi : fullName(h.employee)}</span>
                      <span className="block text-xs text-ink-500">{h.employee.employeeCode}</span>
                    </Td>
                    <Td label={t("payroll.fixation.kind")}>
                      <Badge tone="violet">{tDynamic(t, `payroll.fixation.kinds.${h.reason}`)}</Badge>
                    </Td>
                    <Td label={t("payroll.fixation.from")}>{formatDate(toISODate(h.effectiveFrom), locale)}</Td>
                    <Td label={t("payroll.fixation.newPay")}>
                      L{h.payLevel} C{h.payCell}
                      {!h.applied && <Badge tone="blue" className="ml-2">{t("payroll.fixation.upcoming")}</Badge>}
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
}
