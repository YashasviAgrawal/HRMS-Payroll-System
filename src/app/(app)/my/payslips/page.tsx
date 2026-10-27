import type { Metadata } from "next";
import { Download, FileBadge, Receipt } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { formatMonth } from "@/lib/dates";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { myPayslips } from "@/modules/payroll/payslips";
import { myForm16 } from "@/modules/statutory/form16";
import { MyMoneyTabs } from "../_components/my-money-tabs";

export const metadata: Metadata = { title: "My payslips" };

/** SL-04: the employee's own payslips for any past month — two taps on a phone (menu, then download). */
export default async function MyPayslipsPage() {
  const actor = await requireActor();
  if (!actor.employeeId) return <NoAccess />;
  const { t, locale } = await getT();
  const [slips, forms] = await Promise.all([myPayslips(actor), myForm16(actor)]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("payroll.payslips.myTitle")} description={t("payroll.payslips.mySubtitle")} />
      <MyMoneyTabs active="payslips" t={t} tax={can(actor, "statutory", "view")} />
      {forms.length > 0 && (
        <Card className="mb-5">
          <CardHeader title={t("statutory.my.form16")} description={t("statutory.my.form16Help")} icon={<FileBadge className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <ul className="divide-y divide-ink-100">
              {forms.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="font-semibold text-ink-950">
                    {t("statutory.fy")} {f.fy}
                  </span>
                  <span className="flex gap-2">
                    {f.partA && (
                      <a href={`/api/v1/me/form16/${f.id}/A`} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
                        <Download className="size-4" aria-hidden="true" /> {t("statutory.my.partA")}
                      </a>
                    )}
                    {f.partB && (
                      <a href={`/api/v1/me/form16/${f.id}/B`} target="_blank" rel="noopener" className={buttonClass("primary", "sm")}>
                        <Download className="size-4" aria-hidden="true" /> {t("statutory.my.partB")}
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
      {slips.length === 0 ? (
        <Card>
          <EmptyState icon={<Receipt className="size-6" aria-hidden="true" />} title={t("payroll.payslips.myNone")} description={t("payroll.payslips.myNoneHelp")} />
        </Card>
      ) : (
        <ul className="grid gap-3">
          {slips.map((s) => (
            <li key={s.id}>
              <Card>
                <CardBody className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink-950">
                      {formatMonth(s.month, locale)}
                      {s.kind === "SUPPLEMENTARY" && <Badge tone="violet" className="ml-2">{t("payroll.payslips.supplementary")}</Badge>}
                    </p>
                    <p className="text-sm text-ink-600">
                      {t("payroll.net")}: <span className="tabular font-semibold text-ink-900">{formatINR(s.net)}</span>
                      {s.creditStatus === "FAILED" && <Badge tone="red" className="ml-2">{t("payroll.credit.FAILED")}</Badge>}
                    </p>
                    {s.kind === "SUPPLEMENTARY" && <p className="truncate text-xs text-ink-500">{locale === "hi" ? s.titleHi : s.title}</p>}
                  </div>
                  <div className="flex gap-2">
                    <a href={`/api/v1/payslips/${s.id}/pdf?lang=${locale}`} target="_blank" rel="noopener" className={buttonClass("primary", "md")}>
                      <Download className="size-4" aria-hidden="true" /> {t("payroll.payslips.download")}
                    </a>
                    <a href={`/api/v1/payslips/${s.id}/pdf?lang=${locale === "hi" ? "en" : "hi"}`} target="_blank" rel="noopener" className={buttonClass("ghost", "md")} lang={locale === "hi" ? "en" : "hi"}>
                      {locale === "hi" ? "English" : "हिन्दी"}
                    </a>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {forms.length === 0 && (
        <p className="mt-5 flex items-center gap-2 text-sm text-ink-500">
          <FileBadge className="size-4" aria-hidden="true" />
          {t("statutory.my.form16None")}
        </p>
      )}
    </div>
  );
}
