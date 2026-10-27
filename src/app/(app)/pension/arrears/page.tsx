import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { shiftMonth, todayIST } from "@/lib/dates";
import { getT } from "@/lib/i18n/server";
import { ArrearsForm } from "./arrears-form";

export const metadata: Metadata = { title: "Pension arrears" };

/** PN-05: a dearness relief order dated back — arrears for every pensioner in one bill. */
export default async function PensionArrearsPage() {
  const actor = await requireActor();
  if (!canAll(actor, "pension", "create")) return <NoAccess />;
  const { t } = await getT();
  const month = todayIST().slice(0, 7);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader breadcrumbs={[{ label: t("pension.title"), href: "/pension" }, { label: t("pension.arrears.title") }]} title={t("pension.arrears.title")} description={t("pension.arrears.help")} />
      <Card>
        <CardBody>
          <ArrearsForm from={shiftMonth(month, -3)} to={shiftMonth(month, -1)} max={month} />
        </CardBody>
      </Card>
    </div>
  );
}
