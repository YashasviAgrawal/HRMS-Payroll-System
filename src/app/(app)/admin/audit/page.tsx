import type { Metadata } from "next";
import { History, Lock, Search } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { scopeFor } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime, isISODate } from "@/lib/dates";
import { getT } from "@/lib/i18n/server";
import { auditActions, listAudit } from "@/modules/audit/service";

export const metadata: Metadata = { title: "Audit trail" };

function ValueList({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-ink-400">—</span>;
  if (typeof value !== "object") return <span>{String(value)}</span>;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-ink-400">—</span>;
  return (
    <dl className="space-y-0.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2 text-xs">
          <dt className="shrink-0 text-ink-500">{k}:</dt>
          <dd className="break-all text-ink-800">{typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "—")}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; action?: string; from?: string; to?: string; page?: string }> }) {
  const actor = await requireActor();
  if (!scopeFor(actor, "audit_trail", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const from = sp.from && isISODate(sp.from) ? sp.from : undefined;
  const to = sp.to && isISODate(sp.to) ? sp.to : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const [data, actions] = await Promise.all([listAudit(actor, { q: sp.q, action: sp.action || undefined, from, to, page }), auditActions(actor)]);

  return (
    <div>
      <PageHeader title={t("audit.title")} description={t("audit.subtitle")} actions={<Badge tone="gray">{t("audit.retention")}</Badge>} />
      {data.systemOnly && (
        <p className="mb-5 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {t("audit.systemOnly")}
        </p>
      )}
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-ink-100 px-5 py-4 sm:px-6">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
            <input name="q" defaultValue={sp.q} placeholder={t("audit.searchPlaceholder")} aria-label={t("common.search")} className={controlClass(false, "h-10 pl-9")} />
          </div>
          <select name="action" defaultValue={sp.action ?? ""} aria-label={t("audit.action")} className={controlClass(false, "h-10 w-auto")}>
            <option value="">{t("audit.allActions")}</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-ink-600">
            {t("common.from")}
            <input type="date" name="from" defaultValue={from} className={controlClass(false, "h-10 w-auto")} />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-600">
            {t("common.to")}
            <input type="date" name="to" defaultValue={to} className={controlClass(false, "h-10 w-auto")} />
          </label>
          <button type="submit" className={buttonClass("secondary")}>
            {t("common.search")}
          </button>
        </form>
        {data.rows.length === 0 ? (
          <EmptyState icon={<History className="size-6" aria-hidden="true" />} title={t("common.noData")} />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>{t("audit.when")}</Th>
                  <Th>{t("audit.who")}</Th>
                  <Th>{t("audit.action")}</Th>
                  <Th>{t("audit.summary")}</Th>
                  <Th>{t("audit.changes")}</Th>
                  <Th>{t("audit.ip")}</Th>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((r) => (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap text-ink-600">{formatDateTime(r.at, locale)}</Td>
                    <Td className="whitespace-nowrap">{r.userName ?? "—"}</Td>
                    <Td>
                      <Badge tone={r.category === "SYSTEM" ? "blue" : "green"}>{r.action}</Badge>
                    </Td>
                    <Td className="min-w-[16rem]">
                      <p className="text-ink-900">{r.summary}</p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {r.entityType}
                        {r.entityId ? ` · ${r.entityId}` : ""}
                      </p>
                    </Td>
                    <Td className="min-w-[14rem]">
                      {r.hidden ? (
                        <span className="inline-flex items-center gap-1 text-xs text-ink-400">
                          <Lock className="size-3" aria-hidden="true" /> {t("audit.hidden")}
                        </span>
                      ) : r.oldValue || r.newValue ? (
                        <details className="group">
                          <summary className="cursor-pointer text-xs font-medium text-brand-700 hover:underline">{t("common.view")}</summary>
                          <div className="mt-2 grid gap-2 rounded-lg bg-ink-50 p-2.5">
                            <div>
                              <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-500">{t("audit.oldValue")}</p>
                              <ValueList value={r.oldValue} />
                            </div>
                            <div>
                              <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-500">{t("audit.newValue")}</p>
                              <ValueList value={r.newValue} />
                            </div>
                          </div>
                        </details>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </Td>
                    <Td className="tabular whitespace-nowrap text-xs text-ink-500">{r.ip ?? "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              baseHref="/admin/audit"
              params={{ q: sp.q, action: sp.action, from, to }}
              labels={{
                showing: t("common.showing", { from: (data.page - 1) * data.pageSize + 1, to: Math.min(data.page * data.pageSize, data.total), total: data.total }),
                previous: t("common.previous"),
                next: t("common.next"),
              }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
