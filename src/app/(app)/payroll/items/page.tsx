import type { Metadata } from "next";
import { Clock, ListPlus } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime, todayIST } from "@/lib/dates";
import { getT } from "@/lib/i18n/server";
import { payItemsScreen } from "@/modules/payroll/rates";
import { PayrollTabs } from "../_components/payroll-tabs";
import { ItemsPanel } from "./items-panel";
import { PersonPicker } from "./person-picker";

export const metadata: Metadata = { title: "Pay items" };

/** Standing allowances and deductions per person (PR-03, PR-04); every change goes to a Checker. */
export default async function PayItemsPage({ searchParams }: { searchParams: Promise<{ employee?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "payroll", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const data = await payItemsScreen(actor, sp.employee);

  return (
    <div>
      <PageHeader title={t("payroll.title")} description={t("payroll.items.subtitle")} />
      <PayrollTabs active="items" principal={actor} t={t} />
      <Card className="mb-5">
        <CardBody>
          <PersonPicker people={data.people.map((p) => ({ id: p.id, label: `${p.code} · ${locale === "hi" && p.nameHi ? p.nameHi : p.name}` }))} value={data.chosen?.id ?? ""} />
        </CardBody>
      </Card>
      {data.chosen && (
        <Card>
          <CardHeader title={`${data.chosen.code} · ${locale === "hi" && data.chosen.nameHi ? data.chosen.nameHi : data.chosen.name}`} icon={<ListPlus className="size-4.5" aria-hidden="true" />} />
          {data.pending.length > 0 && (
            <CardBody className="space-y-1 border-b border-ink-100 bg-amber-50/40 py-3">
              {data.pending.map((p) => (
                <p key={p.id} className="flex items-center gap-2 text-sm text-amber-900">
                  <Clock className="size-4" aria-hidden="true" /> {locale === "hi" && p.titleHi ? p.titleHi : p.title} <Badge tone="amber">{p.makerName} · {formatDateTime(p.createdAt, locale)}</Badge>
                </p>
              ))}
            </CardBody>
          )}
          <ItemsPanel employeeId={data.chosen.id} items={data.items} heads={data.heads} canEdit={data.canEdit && !data.chosen.isSelf} isSelf={data.chosen.isSelf} thisMonth={todayIST().slice(0, 7)} />
        </Card>
      )}
    </div>
  );
}
