import type { Metadata } from "next";
import { CheckCircle2, ClipboardCheck, TriangleAlert } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireActor } from "@/lib/auth/session";
import { formatDate, formatMonth, isMonth, toISODate } from "@/lib/dates";
import { getT } from "@/lib/i18n/server";
import { canLockSection, lockPreview } from "@/modules/attendance/service";
import { LockForm } from "./lock-form";

export const metadata: Metadata = { title: "Lock attendance" };

export default async function LockPage({ searchParams }: { searchParams: Promise<{ section?: string; month?: string }> }) {
  const actor = await requireActor();
  const { section, month } = await searchParams;
  if (!section || !month || !isMonth(month) || !canLockSection(actor, section)) return <NoAccess />;
  const { t, locale } = await getT();
  const p = await lockPreview(actor, section, month);
  const sectionName = locale === "hi" ? p.section.nameHi : p.section.name;
  const monthLabel = formatMonth(month, locale);
  const isHrScreen = actor.loginType === "HR_ACCOUNTS";
  const back = isHrScreen ? `/attendance?tab=lock&month=${month}` : `/my/team/attendance?month=${month}`;
  const b = p.blockers;
  const blockers = [
    b.monthNotOver && t("attendance.lock.monthNotOver"),
    b.pendingRequests > 0 && t("attendance.lock.requestsOpen", { count: b.pendingRequests }),
    b.pendingMuster && t("attendance.lock.musterPending"),
    b.unmarked > 0 && t("attendance.lock.unmarked", { count: b.unmarked }),
  ].filter((x): x is string => !!x);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        breadcrumbs={[{ label: isHrScreen ? t("attendance.title") : t("attendance.team.title"), href: back }, { label: `${sectionName} · ${monthLabel}` }]}
        title={t("attendance.lock.pageTitle")}
        description={`${sectionName} · ${monthLabel} · ${t("attendance.lock.staffCount", { count: p.rows.length })}`}
      />
      {p.lock ? (
        <Card>
          <CardBody>
            <p className="flex items-center gap-2 text-sm text-brand-900">
              <CheckCircle2 className="size-4" aria-hidden="true" /> {t("attendance.lock.lockedSummary", { name: p.lock.lockedByName, date: formatDate(toISODate(p.lock.lockedAt), locale) })}
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title={t("attendance.lock.blockers")} icon={blockers.length ? <TriangleAlert className="size-4.5" aria-hidden="true" /> : <CheckCircle2 className="size-4.5" aria-hidden="true" />} />
            <CardBody>
              {blockers.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
                  {blockers.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-brand-800">{t("attendance.lock.ready")}</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("attendance.lock.exceptions")} description={p.exceptions.length ? t("attendance.lock.exceptionsHint") : t("attendance.lock.noExceptions")} icon={<ClipboardCheck className="size-4.5" aria-hidden="true" />} />
            <LockForm
              sectionId={section}
              sectionName={sectionName}
              month={month}
              monthLabel={monthLabel}
              blocked={blockers.length > 0}
              backHref={back}
              leaveChoices={p.leaveChoices}
              exceptions={p.exceptions.map((x) => ({ ...x, firstIn: x.firstIn ? x.firstIn.toISOString() : null, lastOut: x.lastOut ? x.lastOut.toISOString() : null }))}
            />
          </Card>
        </>
      )}
    </div>
  );
}
