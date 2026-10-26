import type { Metadata } from "next";
import { Briefcase, FileSpreadsheet, Hourglass, Plus, UserPlus } from "lucide-react";
import { NoAccess } from "@/components/no-access";
import { Badge, type Tone } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { RowLink } from "@/components/ui/row-link";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { canAll, scopeFor } from "@/lib/auth/access";
import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, toISODate } from "@/lib/dates";
import { listFiles } from "@/lib/files";
import { tDynamic } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { listJoinings, listVacancies, probationList } from "@/modules/recruitment/service";
import { CHECKLIST_ITEMS, type Checklist } from "@/modules/recruitment/schema";
import { FILE_TONE } from "../files/tones";
import { BuildFileButton, ConfirmProbationButton } from "./widgets";

export const metadata: Metadata = { title: "Recruitment and joining" };

const VTONE: Record<string, Tone> = { DRAFT: "gray", PENDING_APPROVAL: "amber", APPROVED: "blue", ADVERTISED: "green", CLOSED: "gray", CANCELLED: "gray", REJECTED: "red" };
const JTONE: Record<string, Tone> = { IN_PROGRESS: "blue", SUBMITTED: "amber", COMPLETED: "green", CANCELLED: "gray" };

export default async function RecruitmentPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireActor();
  if (!scopeFor(actor, "recruitment", "view")) return <NoAccess />;
  const { t, locale } = await getT();
  const { tab = "vacancies" } = await searchParams;
  const canCreate = canAll(actor, "recruitment", "create");
  const isHr = canAll(actor, "employee_master", "create");
  const [sections, posts] = await Promise.all([db.section.findMany({ where: { boardId: actor.boardId } }), db.post.findMany({ where: { boardId: actor.boardId } })]);
  const sName = (id: string) => {
    const s = sections.find((x) => x.id === id);
    return s ? (locale === "hi" ? s.nameHi : s.name) : "—";
  };
  const pName = (id: string) => {
    const p = posts.find((x) => x.id === id);
    return p ? (locale === "hi" ? p.nameHi : p.name) : "—";
  };

  const content = tab === "joining" ? await joiningTab() : tab === "probation" ? await probationTab() : tab === "files" ? await filesTab() : await vacanciesTab();

  return (
    <div>
      <PageHeader
        title={t("recruitment.title")}
        description={t("recruitment.subtitle")}
        actions={
          canCreate && (
            <>
              {isHr && (
                <LinkButton href="/recruitment/joining/new" icon={<UserPlus className="size-4" aria-hidden="true" />}>
                  {t("recruitment.joining.newDirect")}
                </LinkButton>
              )}
              <LinkButton href="/recruitment/vacancies/new" variant="primary" icon={<Plus className="size-4" aria-hidden="true" />}>
                {t("recruitment.newVacancy")}
              </LinkButton>
            </>
          )
        }
      />
      <LinkTabs
        className="mb-5"
        active={tab}
        tabs={(["vacancies", "joining", "probation", "files"] as const).map((k) => ({ key: k, label: t(`recruitment.tabs.${k}`), href: `/recruitment?tab=${k}` }))}
      />

      {content}
    </div>
  );

  async function vacanciesTab() {
    const rows = await listVacancies(actor);
    return (
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Briefcase className="size-6" aria-hidden="true" />} title={t("recruitment.empty")} />
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("recruitment.referenceNo")}</Th>
                <Th>{t("common.post")}</Th>
                <Th align="right">{t("recruitment.seats")}</Th>
                <Th>{t("recruitment.lastDate")}</Th>
                <Th align="right">{t("recruitment.applicants")}</Th>
                <Th align="right">{t("recruitment.joined")}</Th>
                <Th>{t("common.status")}</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((v) => (
                <RowLink key={v.id} href={`/recruitment/vacancies/${v.id}`}>
                  <Td className="tabular font-medium text-ink-900">{v.referenceNo}</Td>
                  <Td>
                    <p className="text-ink-900">{pName(v.postId)}</p>
                    <p className="text-xs text-ink-500">
                      {sName(v.sectionId)} · {t("employees.level", { level: v.payLevel })}
                    </p>
                  </Td>
                  <Td align="right" label={t("recruitment.seats")}>{v.seats}</Td>
                  <Td label={t("recruitment.lastDate")} className="whitespace-nowrap text-ink-600">{formatDate(v.lastDate, locale)}</Td>
                  <Td align="right" label={t("recruitment.applicants")}>{v._count.applicants}</Td>
                  <Td align="right" label={t("recruitment.joined")}>{v._count.joinings}</Td>
                  <Td label={t("common.status")}>
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={VTONE[v.status]} dot>
                        {tDynamic(t, `recruitment.vstatus.${v.status}`)}
                      </Badge>
                      {v.selectionStatus !== "OPEN" && <Badge tone={v.selectionStatus === "APPROVED" ? "green" : "amber"}>{tDynamic(t, `recruitment.sstatus.${v.selectionStatus}`)}</Badge>}
                    </div>
                  </Td>
                </RowLink>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    );
  }

  async function joiningTab() {
    const rows = await listJoinings(actor);
    return (
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<UserPlus className="size-6" aria-hidden="true" />} title={t("recruitment.joining.empty")} />
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("common.name")}</Th>
                <Th>{t("common.post")}</Th>
                <Th>{t("employees.fields.dateOfJoining")}</Th>
                <Th>{t("recruitment.joining.checklist")}</Th>
                <Th>{t("common.status")}</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((j) => {
                const done = CHECKLIST_ITEMS.filter((k) => (j.checklist as unknown as Checklist)[k]?.done).length;
                return (
                  <RowLink key={j.id} href={`/recruitment/joining/${j.id}`}>
                    <Td>
                      <p className="font-medium text-ink-900">{[j.employee.firstName, j.employee.lastName].filter(Boolean).join(" ")}</p>
                      <p className="text-xs text-ink-500">{j.applicant?.appointmentLetterNo ?? tDynamic(t, `employees.type.${j.employee.type}`)}</p>
                    </Td>
                    <Td>
                      <p>{locale === "hi" ? j.employee.post.nameHi : j.employee.post.name}</p>
                      <p className="text-xs text-ink-500">{locale === "hi" ? j.employee.section.nameHi : j.employee.section.name}</p>
                    </Td>
                    <Td label={t("employees.fields.dateOfJoining")} className="whitespace-nowrap text-ink-600">{formatDate(toISODate(j.employee.dateOfJoining), locale)}</Td>
                    <Td label={t("recruitment.joining.checklist")}>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-100">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${(done / CHECKLIST_ITEMS.length) * 100}%` }} />
                        </div>
                        <span className="tabular text-xs text-ink-500">{t("recruitment.joining.progress", { done, total: CHECKLIST_ITEMS.length })}</span>
                      </div>
                    </Td>
                    <Td label={t("common.status")}>
                      <Badge tone={JTONE[j.status]} dot>
                        {tDynamic(t, `recruitment.joining.status.${j.status}`)}
                      </Badge>
                    </Td>
                  </RowLink>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    );
  }

  async function probationTab() {
    const rows = await probationList(actor);
    return (
      <Card>
        <CardHeader title={t("recruitment.probation.title")} description={t("recruitment.probation.subtitle")} icon={<Hourglass className="size-4.5" aria-hidden="true" />} />
        {rows.length === 0 ? (
          <EmptyState title={t("recruitment.probation.empty")} />
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("employees.columns.employee")}</Th>
                <Th>{t("common.post")}</Th>
                <Th>{t("recruitment.probation.endsOn")}</Th>
                <Th>{t("common.status")}</Th>
                <Th />
              </tr>
            </THead>
            <tbody>
              {rows.map((e) => (
                <Tr key={e.id}>
                  <Td>
                    <p className="font-medium text-ink-900">{locale === "hi" && e.nameHi ? e.nameHi : [e.firstName, e.lastName].filter(Boolean).join(" ")}</p>
                    <p className="tabular text-xs text-ink-500">{e.employeeCode}</p>
                  </Td>
                  <Td>{locale === "hi" ? e.post.nameHi : e.post.name}</Td>
                  <Td label={t("recruitment.probation.endsOn")} className="whitespace-nowrap">{formatDate(e.probationEnd, locale)}</Td>
                  <Td label={t("common.status")}>
                    {e.confirming ? (
                      <Badge tone="amber">{t("recruitment.probation.confirming")}</Badge>
                    ) : e.overdue ? (
                      <Badge tone="red" dot>{t("recruitment.probation.overdue")}</Badge>
                    ) : e.dueSoon ? (
                      <Badge tone="amber" dot>{t("recruitment.probation.dueSoon")}</Badge>
                    ) : (
                      <Badge tone="gray">{t("recruitment.probation.onTrack")}</Badge>
                    )}
                  </Td>
                  <Td align="right" actions>{isHr && !e.confirming && (e.overdue || e.dueSoon) && <ConfirmProbationButton employeeId={e.id} defaultDate={e.probationEnd} />}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    );
  }

  async function filesTab() {
    const files = await listFiles(actor, ["PRAN_REGISTRATION", "EPF_ESIC_REGISTRATION"]);
    return (
      <div className="space-y-6">
        <p className="text-sm text-ink-500">{t("recruitment.files.subtitle")}</p>
        {canCreate && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardBody className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-ink-900">{t("recruitment.files.pran")}</p>
                  <p className="text-sm text-ink-500">{t("recruitment.files.pranHint")}</p>
                </div>
                <BuildFileButton url="/api/v1/recruitment/files/pran" />
              </CardBody>
            </Card>
            <Card>
              <CardBody className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-ink-900">{t("recruitment.files.epf")}</p>
                  <p className="text-sm text-ink-500">{t("recruitment.files.epfHint")}</p>
                </div>
                <BuildFileButton url="/api/v1/recruitment/files/epf" />
              </CardBody>
            </Card>
          </div>
        )}
        <Card>
          {files.length === 0 ? (
            <EmptyState icon={<FileSpreadsheet className="size-6" aria-hidden="true" />} title={t("files.empty")} />
          ) : (
            <Table stack>
              <THead>
                <tr>
                  <Th>{t("files.title")}</Th>
                  <Th>{t("audit.who")}</Th>
                  <Th>{t("audit.when")}</Th>
                  <Th>{t("common.status")}</Th>
                </tr>
              </THead>
              <tbody>
                {files.map((f) => (
                  <RowLink key={f.id} href={`/files/${f.id}`}>
                    <Td className="font-medium text-ink-900">{f.fileName}</Td>
                    <Td label={t("audit.who")}>{f.createdByName}</Td>
                    <Td label={t("audit.when")} className="whitespace-nowrap text-ink-600">{formatDateTime(f.createdAt, locale)}</Td>
                    <Td label={t("common.status")}>
                      <Badge tone={FILE_TONE[f.status]} dot>
                        {tDynamic(t, `files.status.${f.status}`)}
                      </Badge>
                    </Td>
                  </RowLink>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    );
  }
}
