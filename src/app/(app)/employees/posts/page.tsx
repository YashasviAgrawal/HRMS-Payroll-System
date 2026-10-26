import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { canAll, scopeFor } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { sanctionedOverview } from "@/modules/employees/records";
import { PostsTable } from "./posts-table";

export const metadata: Metadata = { title: "Sanctioned posts" };

export default async function PostsPage() {
  const actor = await requireActor();
  if (!scopeFor(actor, "employee_master", "view") || actor.loginType === "EMPLOYEE") return <NoAccess />;
  const { t, locale } = await getT();
  const data = await sanctionedOverview(actor);
  const total = data.rows.reduce((a, r) => ({ s: a.s + r.sanctioned, f: a.f + r.filled, v: a.v + r.vacant, x: a.x + r.excess }), { s: 0, f: 0, v: 0, x: 0 });
  return (
    <div>
      <PageHeader breadcrumbs={[{ label: t("employees.title"), href: "/employees" }, { label: t("employees.postsPage.title") }]} title={t("employees.postsPage.title")} description={t("employees.postsPage.subtitle")} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("employees.postsPage.sanctioned")} value={total.s} tone="blue" />
        <StatTile label={t("employees.postsPage.filled")} value={total.f} tone="green" />
        <StatTile label={t("employees.postsPage.vacant")} value={total.v} tone="amber" />
        <StatTile label={t("employees.postsPage.excess")} value={total.x} tone={total.x ? "red" : "gray"} />
      </div>
      <PostsTable
        rows={data.rows.map((r) => ({
          sectionId: r.sectionId,
          postId: r.postId,
          section: locale === "hi" ? r.section.nameHi : r.section.name,
          post: locale === "hi" ? r.post.nameHi : r.post.name,
          level: r.post.payLevel,
          sanctioned: r.sanctioned,
          filled: r.filled,
          vacant: r.vacant,
          excess: r.excess,
        }))}
        sections={data.sections.map((s) => ({ id: s.id, name: locale === "hi" ? s.nameHi : s.name }))}
        posts={data.posts.map((p) => ({ id: p.id, name: locale === "hi" ? p.nameHi : p.name, level: p.payLevel }))}
        canEdit={canAll(actor, "employee_master", "create")}
      />
      <p className="mt-4 text-sm text-ink-500">{t("employees.postsPage.onlyPermanent")}</p>
    </div>
  );
}
