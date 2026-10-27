import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { getT } from "@/lib/i18n/server";
import { caseCandidates } from "@/modules/pension/cases";
import { CaseForm } from "../case-form";

export const metadata: Metadata = { title: "New pension case" };

/** PN-08: start a case — the calculator reads the service book, pay, leave and GPF from the records. */
export default async function NewCasePage({ searchParams }: { searchParams: Promise<{ employee?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "pension", "create")) return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const all = await caseCandidates(actor);
  const people = sp.employee && all.some((p) => p.id === sp.employee) ? all.filter((p) => p.id === sp.employee) : all;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader breadcrumbs={[{ label: t("pension.title"), href: "/pension" }, { label: t("pension.tabs.cases"), href: "/pension/cases" }, { label: t("pension.cases.start") }]} title={t("pension.cases.start")} description={t("pension.case.newHelp")} />
      <Card>
        <CardBody>
          {all.length === 0 ? (
            <p className="text-sm text-ink-600">{t("pension.case.nobody")}</p>
          ) : (
            <CaseForm
              people={people.map((p) => ({
                id: p.id,
                label: `${locale === "hi" && p.nameHi ? p.nameHi : p.name} (${p.code ?? "—"}) — ${p.scheme}${p.dateOfRetirement ? ` · ${formatDate(p.dateOfRetirement, locale)}` : ""}`,
                scheme: p.scheme,
                status: p.status,
                dateOfRetirement: p.dateOfRetirement,
                exitDate: p.exitDate,
                bankLast4: p.bankLast4,
                family: p.family,
              }))}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
