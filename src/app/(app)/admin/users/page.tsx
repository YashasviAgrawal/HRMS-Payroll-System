import type { Metadata } from "next";
import { Search, UserPlus, Users } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { RowLink } from "@/components/ui/row-link";
import { Table, Td, Th, THead } from "@/components/ui/table";
import { can } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { maskMobile } from "@/lib/utils";
import { listUsers } from "@/modules/users/service";

export const metadata: Metadata = { title: "Users and permissions" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; loginType?: string; status?: string; page?: string }> }) {
  const actor = await requireActor();
  if (!can(actor, "users_settings", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const loginType = ["ADMIN", "HR_ACCOUNTS", "EMPLOYEE"].includes(sp.loginType ?? "") ? (sp.loginType as "ADMIN") : undefined;
  const status = sp.status === "ACTIVE" || sp.status === "DISABLED" ? sp.status : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const data = await listUsers(actor, { q: sp.q, loginType, status, page });
  const canEdit = actor.permissions.includes("USER_SETTINGS_MANAGER");

  return (
    <div>
      <PageHeader
        title={t("users.title")}
        description={canEdit ? t("users.subtitle") : t("users.readOnly")}
        actions={
          canEdit && (
            <LinkButton href="/admin/users/new" variant="primary" icon={<UserPlus className="size-4" aria-hidden="true" />}>
              {t("users.add")}
            </LinkButton>
          )
        }
      />
      <Card>
        <form className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-5 py-4 sm:px-6" method="get">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
            <input name="q" defaultValue={sp.q} placeholder={t("users.searchPlaceholder")} aria-label={t("common.search")} className={controlClass(false, "h-10 pl-9")} />
          </div>
          <select name="loginType" defaultValue={loginType ?? ""} aria-label={t("users.loginType")} className={controlClass(false, "h-10 w-auto")}>
            <option value="">{t("users.allLogins")}</option>
            {(["ADMIN", "HR_ACCOUNTS", "EMPLOYEE"] as const).map((l) => (
              <option key={l} value={l}>
                {tDynamic(t, `loginType.${l}`)}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status ?? ""} aria-label={t("common.status")} className={controlClass(false, "h-10 w-auto")}>
            <option value="">{t("users.allStatuses")}</option>
            <option value="ACTIVE">{t("common.active")}</option>
            <option value="DISABLED">{t("common.disabled")}</option>
          </select>
          <button type="submit" className={buttonClass("secondary")}>
            {t("common.search")}
          </button>
        </form>
        {data.rows.length === 0 ? (
          <EmptyState icon={<Users className="size-6" aria-hidden="true" />} title={t("common.noData")} />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>{t("common.name")}</Th>
                  <Th>{t("users.loginType")}</Th>
                  <Th>{t("users.permissions")}</Th>
                  <Th>{t("common.mobile")}</Th>
                  <Th>{t("users.lastLogin")}</Th>
                  <Th>{t("common.status")}</Th>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((u) => (
                  <RowLink key={u.id} href={`/admin/users/${u.id}`}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={u.displayName} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink-900">{locale === "hi" && u.displayNameHi ? u.displayNameHi : u.displayName}</p>
                          <p className="tabular text-xs text-ink-500">{u.loginId}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">{tDynamic(t, `loginType.${u.loginType}`)}</Td>
                    <Td>
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {u.permissions.length === 0 ? (
                          <span className="text-ink-400">—</span>
                        ) : (
                          u.permissions.map((p) => (
                            <Badge key={p} tone="green">
                              {tDynamic(t, `permission.${p}`)}
                            </Badge>
                          ))
                        )}
                      </div>
                    </Td>
                    <Td className="tabular whitespace-nowrap text-ink-600">{maskMobile(u.mobile)}</Td>
                    <Td className="whitespace-nowrap text-ink-600">{u.lastLoginAt ? formatDateTime(u.lastLoginAt, locale) : t("users.never")}</Td>
                    <Td>
                      <Badge tone={u.status === "ACTIVE" ? "green" : "gray"} dot>
                        {u.status === "ACTIVE" ? t("common.active") : t("common.disabled")}
                      </Badge>
                    </Td>
                  </RowLink>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              baseHref="/admin/users"
              params={{ q: sp.q, loginType, status }}
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
