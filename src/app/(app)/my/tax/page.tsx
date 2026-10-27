import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { myTax } from "@/modules/statutory/tax";
import { MyMoneyTabs } from "../_components/my-money-tabs";
import { MyTaxForm } from "./my-tax-form";

export const metadata: Metadata = { title: "My tax" };

/** ST-02, ST-03, S-51 (employee): regime for the year, investment declaration and proofs. */
export default async function MyTaxPage() {
  const actor = await requireActor();
  // Retirees reach their pension slips here but their tax is no longer worked out through salary.
  if (!actor.employeeId || !can(actor, "statutory", "view")) return <NoAccess />;
  const { t } = await getT();
  const data = await myTax(actor);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("statutory.my.title")} description={t("statutory.my.subtitle", { fy: data.fy })} />
      <MyMoneyTabs active="tax" t={t} />
      <MyTaxForm
        fy={data.fy}
        declaration={data.declaration}
        waitingForCheck={data.waitingForCheck}
        year={data.year}
        tdsSoFar={data.tdsSoFar}
        monthsToCome={data.monthsToCome}
        rules={data.rules}
        metro={data.metro}
        caps={data.caps}
        proofsDueOn={data.proofsDueOn}
      />
    </div>
  );
}
