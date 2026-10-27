import type { Metadata } from "next";
import { CalendarDays, Megaphone, Users } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { canAll, scopeFor } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDate, todayIST, toISODate } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { formatINR } from "@/lib/money";
import { matrixToday } from "@/modules/payroll/compute";
import { basicIn } from "@/modules/payroll/matrix-7cpc";
import { RESERVATION_CATEGORIES } from "@/modules/recruitment/schema";
import { getVacancy } from "@/modules/recruitment/service";
import { ApplicantsPanel, VacancyActions } from "./vacancy-client";

export const metadata: Metadata = { title: "Vacancy" };

export default async function VacancyPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (!scopeFor(actor, "recruitment", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const { id } = await params;
  const v = await getVacancy(actor, id);
  const [post, section, matrix] = await Promise.all([db.post.findUniqueOrThrow({ where: { id: v.postId } }), db.section.findUniqueOrThrow({ where: { id: v.sectionId } }), matrixToday(actor.boardId, db)]);
  const reservation = v.reservation as Record<string, number>;
  const canCreate = canAll(actor, "recruitment", "create");
  const canJoin = canAll(actor, "employee_master", "create");
  const counts = { selected: v.applicants.filter((a) => a.status === "SELECTED").length, waitlisted: v.applicants.filter((a) => a.status === "WAITLISTED").length };

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: t("recruitment.title"), href: "/recruitment" }, { label: v.referenceNo }]}
        title={locale === "hi" ? post.nameHi : post.name}
        description={`${v.referenceNo} · ${locale === "hi" ? section.nameHi : section.name} · ${t("recruitment.seatsCount", { count: v.seats })}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={v.status === "ADVERTISED" ? "green" : v.status === "PENDING_APPROVAL" ? "amber" : "gray"} dot>
              {tDynamic(t, `recruitment.vstatus.${v.status}`)}
            </Badge>
            <Badge tone={v.selectionStatus === "APPROVED" ? "green" : v.selectionStatus === "PENDING_APPROVAL" ? "amber" : "gray"}>{tDynamic(t, `recruitment.sstatus.${v.selectionStatus}`)}</Badge>
            {canCreate && <VacancyActions vacancyId={v.id} status={v.status} advert={{ advertNumber: v.advertNumber ?? "", advertDate: v.advertDate ? toISODate(v.advertDate) : todayIST(), lastDate: v.lastDate ? toISODate(v.lastDate) : "" }} />}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("common.details")} icon={<Megaphone className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <DescriptionList
              columns={3}
              items={[
                { label: t("common.post"), value: `${locale === "hi" ? post.nameHi : post.name} · ${t("employees.level", { level: v.payLevel })}` },
                { label: t("employees.fields.basicPay"), value: formatINR(basicIn(matrix, v.payLevel, 1)) },
                { label: t("recruitment.seats"), value: v.seats },
                { label: t("recruitment.advertNumber"), value: v.advertNumber ?? "—" },
                { label: t("recruitment.advertDate"), value: formatDate(v.advertDate, locale) },
                { label: t("recruitment.lastDate"), value: formatDate(v.lastDate, locale) },
              ]}
            />
            {v.notes && <p className="mt-5 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">{v.notes}</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("recruitment.reservation")} icon={<Users className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            <ul className="space-y-2">
              {RESERVATION_CATEGORIES.map((c) => {
                const selected = v.applicants.filter((a) => a.status === "SELECTED" && a.category === c).length;
                return (
                  <li key={c} className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 text-sm">
                    <span className="font-medium">{tDynamic(t, `employees.category.${c}`)}</span>
                    <span className="tabular text-ink-600">
                      {selected} / {reservation[c] ?? 0}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-500">
              <CalendarDays className="size-3.5" aria-hidden="true" /> {t("recruitment.selectionNote", { selected: counts.selected, seats: v.seats, waitlisted: counts.waitlisted })}
            </p>
          </CardBody>
        </Card>
      </div>

      <ApplicantsPanel
        vacancyId={v.id}
        canEdit={canCreate && v.selectionStatus === "OPEN" && (v.status === "ADVERTISED" || v.status === "APPROVED")}
        canSubmit={canCreate && v.selectionStatus === "OPEN" && counts.selected > 0}
        selectionApproved={v.selectionStatus === "APPROVED"}
        canJoin={canJoin}
        applicants={v.applicants.map((a) => ({
          id: a.id,
          applicationNo: a.applicationNo,
          name: locale === "hi" && a.nameHi ? a.nameHi : a.name,
          category: a.category,
          gender: a.gender,
          dateOfBirth: toISODate(a.dateOfBirth),
          mobile: a.mobile,
          status: a.status,
          score: a.score ? Number(a.score) : null,
          meritRank: a.meritRank,
          appointmentLetterNo: a.appointmentLetterNo,
          joiningId: a.joining && a.joining.status !== "CANCELLED" ? a.joining.id : null,
        }))}
      />
    </div>
  );
}
