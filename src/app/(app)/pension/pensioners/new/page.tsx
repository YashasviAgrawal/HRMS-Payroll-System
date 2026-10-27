import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { pensionableFormer } from "@/modules/pension/pensioners";
import { NewPensionerForm } from "./new-pensioner-form";

export const metadata: Metadata = { title: "Add a pensioner" };

/** PN-01: a pensioner of the old system not yet on the rolls here — a Checker approves. */
export default async function NewPensionerPage() {
  const actor = await requireActor();
  if (!canAll(actor, "pension", "create")) return <NoAccess />;
  const { t, locale } = await getT();
  const people = await pensionableFormer(actor);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader breadcrumbs={[{ label: t("pension.title"), href: "/pension" }, { label: t("pension.tabs.pensioners"), href: "/pension/pensioners" }, { label: t("pension.pensioners.add") }]} title={t("pension.pensioners.add")} description={t("pension.newPensioner.help")} />
      <Card>
        <CardBody>
          {people.length === 0 ? <p className="text-sm text-ink-600">{t("pension.newPensioner.nobody")}</p> : <NewPensionerForm people={people.map((p) => ({ id: p.id, label: `${locale === "hi" && p.nameHi ? p.nameHi : p.name} (${p.code ?? "—"})`, name: p.name, startDate: p.startDate }))} />}
        </CardBody>
      </Card>
    </div>
  );
}
