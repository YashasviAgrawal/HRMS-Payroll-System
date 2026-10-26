import type { Metadata } from "next";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { requireActor } from "@/lib/auth/session";
import { addDays, isISODate, monthOf, shiftMonth, todayIST } from "@/lib/dates";
import { getT } from "@/lib/i18n/server";
import { leaveRules } from "@/modules/leave/balance";
import { myLeave } from "@/modules/leave/service";
import { BalanceCards } from "../_components/balance-cards";
import { ApplyForm } from "./apply-form";

export const metadata: Metadata = { title: "Apply for leave" };

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ type?: string; date?: string }> }) {
  const actor = await requireActor();
  if (actor.loginType !== "EMPLOYEE" || !actor.employeeId) return <NoAccess />;
  const { t, locale } = await getT();
  const sp = await searchParams;
  const data = await myLeave(actor);
  const today = todayIST();
  const date = sp.date && isISODate(sp.date) ? sp.date : today;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader breadcrumbs={[{ label: t("leave.title"), href: "/leave" }, { label: t("leave.apply") }]} title={t("leave.apply")} description={t("leave.applySubtitle")} />
      <BalanceCards balances={data.balances.filter((b) => b.creditMode === "HALF_YEARLY" || b.creditMode === "YEARLY")} t={t} locale={locale} compact />
      <ApplyForm
        types={data.balances.map((b) => ({ code: b.code, name: locale === "hi" ? b.nameHi : b.name, available: b.available, creditMode: b.creditMode }))}
        rules={Object.fromEntries((await leaveRules(actor.boardId)).map((r) => [r.code, { halfDayAllowed: r.halfDayAllowed, needsCertificate: r.needsCertificate, restrictedOnly: r.restrictedOnly }]))}
        restrictedHolidays={data.restrictedHolidays.map((h) => ({ date: h.date, name: locale === "hi" ? h.nameHi : h.name }))}
        initial={{ leaveCode: sp.type && data.balances.some((b) => b.code === sp.type) ? sp.type : (data.balances[0]?.code ?? ""), fromDate: date, toDate: date }}
        minDate={`${shiftMonth(monthOf(today), -1)}-01`}
        maxDate={addDays(today, 365)}
      />
    </div>
  );
}
