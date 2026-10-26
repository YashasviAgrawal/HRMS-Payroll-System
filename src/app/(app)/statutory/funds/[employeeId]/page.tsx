import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/ui/page-header";
import { canAll } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { todayIST } from "@/lib/dates";
import { getT } from "@/lib/i18n/server";
import { gpfAccount } from "@/modules/statutory/gpf";
import { GpfAccountView } from "../../_components/gpf-account-view";
import { GpfAdvanceForm } from "./advance-form";

export const metadata: Metadata = { title: "GPF account" };

/** S-50: one GPF account — the year month by month, entries, advances, and a new advance or withdrawal. */
export default async function GpfAccountPage({ params, searchParams }: { params: Promise<{ employeeId: string }>; searchParams: Promise<{ fy?: string }> }) {
  const actor = await requireActor();
  if (!canAll(actor, "statutory", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const { employeeId } = await params;
  const a = await gpfAccount(actor, employeeId, (await searchParams).fy);
  const waiting = a.advances.some((x) => x.status === "PENDING");

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/statutory/funds" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("statutory.gpf.accounts")}
      </Link>
      <PageHeader title={`${locale === "hi" && a.employee.nameHi ? a.employee.nameHi : a.employee.name} · ${a.employee.code}`} description={`${t("statutory.gpf.account")} ${a.employee.gpfNumber ?? ""}`} />
      {a.canSanction && !waiting && (
        <div className="mb-5">
          <GpfAdvanceForm employeeId={a.employee.id} limits={a.limits} today={todayIST()} />
        </div>
      )}
      <GpfAccountView a={a} t={t} locale={locale} href={(fy) => `/statutory/funds/${employeeId}?fy=${fy}`} />
    </div>
  );
}
