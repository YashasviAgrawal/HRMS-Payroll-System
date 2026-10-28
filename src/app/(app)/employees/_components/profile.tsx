import { BookOpen, BriefcaseBusiness, CalendarCheck, CalendarClock, CalendarDays, Clock, DoorOpen, FileText, HandCoins, History, Hourglass, IndianRupee, Pencil, Phone, PiggyBank, Receipt, ShieldAlert, UserX, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClass, LinkButton } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMonth, todayIST } from "@/lib/dates";
import { tDynamic, type TFunction } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/types";
import { formatINR } from "@/lib/money";
import { getFamily, listDocuments, listServiceBook } from "@/modules/employees/records";
import { addressLine } from "@/modules/employees/present";
import { canRevealIds, fieldHistory, pendingChanges, type EmployeeView } from "@/modules/employees/service";
import { getSetting } from "@/modules/settings/service";
import { docTypeName } from "@/modules/settings/schema";
import { employeeOverview, leaveApplicationsOf, payslipsOf } from "@/modules/employees/overview";
import { fyList, monthsOfFy, parsePeriod, yearList, type Period } from "@/modules/employees/period";
import { myPayslips } from "@/modules/payroll/payslips";
import { canRecordSeparation, currentSeparation } from "@/modules/employees/separation";
import { LEAVE_TONE } from "../../leave/_components/tones";
import { SeparationDialog } from "./separation-dialog";
import { statusTone, typeTone } from "./tones";
import { DocumentDelete, DocumentUpload, RevealValue, ServiceEntryDialog, WithdrawButton } from "./widgets";

export const PROFILE_TABS = ["overview", "personal", "job", "ids", "family", "documents", "serviceBook", "leave", "payslips", "history"] as const;
/** Tabs only HR & Accounts see; an employee's own record leaves them out. */
export const HR_ONLY_TABS: ProfileTab[] = ["overview", "history"];
export type ProfileTab = (typeof PROFILE_TABS)[number];
const EDITABLE: ProfileTab[] = ["personal", "job", "ids", "family"];

interface Props {
  e: EmployeeView;
  actor: Actor;
  tab: ProfileTab;
  t: TFunction;
  locale: Locale;
  /** "hr" = the HR & Accounts view; "self" = the employee's own record. */
  mode: "hr" | "self";
  basePath: string;
  /** Month / year chosen on the Overview, Payslips and Leave tabs (from the address). */
  filters?: Filters;
}

export type Filters = { view?: string; month?: string; fy?: string; year?: string };

const dash = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

export async function EmployeeProfile({ e, actor, tab, t, locale, mode, basePath, filters = {} }: Props) {
  const hr = mode === "hr" && canAll(actor, "employee_master", "create") && e.id !== actor.employeeId;
  const [pending, sep] = await Promise.all([pendingChanges(actor, e.id), mode === "hr" ? currentSeparation(actor, e.id) : null]);
  const name = locale === "hi" && e.nameHi ? e.nameHi : e.name;
  // Client add-on: HR records a suspension or the person leaving (nothing else waiting for them).
  const canSeparate = mode === "hr" && canRecordSeparation(actor) && e.id !== actor.employeeId && ["ACTIVE", "SUSPENDED"].includes(e.status) && sep?.status !== "PENDING" && !(sep && sep.kind !== "SUSPENSION");
  const tabs = PROFILE_TABS.filter((x) => mode === "hr" || !HR_ONLY_TABS.includes(x)).map((key) => ({
    key,
    label: t(`employees.tabs.${key}`),
    href: `${basePath}?tab=${key}`,
  }));

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-brand-800 via-brand-700 to-brand-600 sm:h-24" aria-hidden="true">
          <div className="grid-pattern h-full w-full opacity-40" />
        </div>
        <div className="px-5 pb-5 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex min-w-0 items-end gap-4">
              <Avatar name={e.name} size="lg" className="-mt-10 size-20 text-2xl ring-4 sm:-mt-12 sm:size-24" />
              <div className="min-w-0 pb-1 pt-3">
                <h1 className="truncate text-xl font-semibold tracking-tight text-ink-950 sm:text-2xl">{name}</h1>
                {locale === "en" && e.nameHi && <p className="text-sm text-ink-500" lang="hi">{e.nameHi}</p>}
                {locale === "hi" && <p className="text-sm text-ink-500">{e.name}</p>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pb-1">
              <Badge tone="gray" className="tabular">{e.employeeCode ?? "—"}</Badge>
              <Badge tone={typeTone(e.type)}>{tDynamic(t, `employees.type.${e.type}`)}</Badge>
              <Badge tone={statusTone(e.status)} dot>
                {tDynamic(t, `employees.status.${e.status}`)}
              </Badge>
              {canSeparate && <SeparationDialog employeeId={e.id} status={e.status} />}
              {hr && EDITABLE.includes(tab) && (
                <LinkButton href={`/employees/${e.id}/edit?tab=${tab}`} size="sm" variant="primary" icon={<Pencil className="size-4" aria-hidden="true" />}>
                  {t("employees.profile.edit")}
                </LinkButton>
              )}
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-ink-100 pt-5 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { icon: Users, label: t("employees.fields.postId"), value: `${locale === "hi" ? e.post.nameHi : e.post.name}` },
              { icon: CalendarDays, label: t("employees.fields.sectionId"), value: locale === "hi" ? e.section.nameHi : e.section.name },
              { icon: Clock, label: t("employees.fields.dateOfJoining"), value: `${formatDate(e.dateOfJoining, locale)} · ${t("employees.profile.years", { years: e.serviceYears })}` },
              { icon: CalendarClock, label: t("employees.fields.dateOfRetirement"), value: e.dateOfRetirement ? formatDate(e.dateOfRetirement, locale) : t("employees.profile.noRetirement") },
              { icon: Phone, label: t("employees.fields.mobile"), value: dash(e.mobile) },
            ].map((f) => (
              <div key={f.label} className="relative min-h-9 min-w-0 pl-11">
                <dt className="text-xs text-ink-500">
                  <span className="absolute left-0 top-0.5 flex size-8 items-center justify-center rounded-lg bg-ink-50 text-ink-500" aria-hidden="true">
                    <f.icon className="size-4" />
                  </span>
                  {f.label}
                </dt>
                <dd className="truncate text-sm font-medium text-ink-900">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      {e.status === "DRAFT" && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900">
          <Hourglass className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">{t("employees.profile.draftTitle")}</p>
            <p className="mt-0.5 text-sm">{t("employees.profile.draftBody")}</p>
          </div>
        </div>
      )}

      {sep && (
        <div data-testid="separation-banner" className={`flex flex-wrap items-start justify-between gap-3 rounded-2xl border px-5 py-4 ${sep.kind === "SUSPENSION" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <div className="flex items-start gap-3">
            {sep.kind === "SUSPENSION" ? <UserX className="mt-0.5 size-5 shrink-0" aria-hidden="true" /> : <DoorOpen className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}
            <div>
              <p className="font-medium">
                {sep.status === "PENDING"
                  ? t("employees.exit.banner.waiting", { what: tDynamic(t, `employees.exit.kind.${sep.kind}`), date: formatDate(sep.effectiveDate, locale) })
                  : sep.kind === "SUSPENSION"
                    ? t("employees.exit.banner.suspended", { date: formatDate(sep.effectiveDate, locale) })
                    : t(e.status === "ACTIVE" || e.status === "SUSPENDED" ? "employees.exit.banner.leaving" : "employees.exit.banner.left", { what: tDynamic(t, `employees.exit.kind.${sep.kind}`), date: formatDate(sep.effectiveDate, locale) })}
              </p>
              <p className="mt-0.5 text-sm">
                {t("employees.exit.banner.order", { order: sep.orderNumber, date: formatDate(sep.orderDate, locale) })}
                {sep.status === "APPROVED" && sep.kind !== "SUSPENSION" && <> · {tDynamic(t, `employees.exit.settlementStatus.${sep.settlementStatus}`)}</>}
              </p>
            </div>
          </div>
          <LinkButton href={`/employees/exits/${sep.id}`} size="sm">
            {t("common.open")}
          </LinkButton>
        </div>
      )}

      {pending.map((p) => (
        <div key={p.id} className="rounded-2xl border border-gold-500/30 bg-gold-50/70 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-gold-600" aria-hidden="true" />
              <div>
                <p className="font-medium text-ink-900">{t("employees.profile.pendingTitle")}</p>
                <p className="mt-0.5 text-sm text-ink-600">{t("employees.profile.pendingBody", { name: p.makerName, date: formatDateTime(p.createdAt, locale) })}</p>
              </div>
            </div>
            <div className="flex gap-2">
              {p.makerId === actor.userId && <WithdrawButton taskId={p.id} />}
              <LinkButton href={`/approvals/${p.id}`} size="sm">
                {t("common.open")}
              </LinkButton>
            </div>
          </div>
          {p.rows.length > 0 && (
            <ul className="mt-3 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
              {p.rows.slice(0, 6).map((r, i) => (
                <li key={i} className="flex flex-wrap gap-x-2">
                  <span className="text-ink-500">{locale === "hi" && r.labelHi ? r.labelHi : r.label}:</span>
                  {r.old !== undefined && r.old !== null && <span className="text-ink-400 line-through">{r.old}</span>}
                  <span className="font-medium text-ink-900">{r.new ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <LinkTabs tabs={tabs} active={tab} />

      {tab === "personal" && (
        <Card>
          <CardBody>
            <DescriptionList
              columns={3}
              items={[
                { label: t("employees.fields.firstName"), value: e.firstName },
                { label: t("employees.fields.middleName"), value: dash(e.middleName) },
                { label: t("employees.fields.lastName"), value: dash(e.lastName) },
                { label: t("employees.fields.nameHi"), value: dash(e.nameHi) },
                { label: t("employees.fields.gender"), value: tDynamic(t, `employees.gender.${e.gender}`) },
                { label: t("employees.fields.dateOfBirth"), value: formatDate(e.dateOfBirth, locale) },
                { label: t("employees.fields.fatherOrSpouseName"), value: dash(e.fatherOrSpouseName) },
                { label: t("employees.fields.category"), value: e.category ? tDynamic(t, `employees.category.${e.category}`) : "—" },
                { label: t("employees.fields.maritalStatus"), value: e.maritalStatus ? tDynamic(t, `employees.marital.${e.maritalStatus}`) : "—" },
                { label: t("employees.fields.bloodGroup"), value: dash(e.bloodGroup) },
                { label: t("employees.fields.isDisabled"), value: e.isDisabled ? t("common.yes") : t("common.no") },
                { label: t("employees.fields.email"), value: dash(e.email) },
                { label: t("employees.fields.presentAddress"), value: addressLine(e.presentAddress) ?? "—" },
                { label: t("employees.fields.permanentAddress"), value: addressLine(e.permanentAddress) ?? "—" },
              ]}
            />
          </CardBody>
        </Card>
      )}

      {tab === "job" && (
        <Card>
          <CardBody>
            <DescriptionList
              columns={3}
              items={[
                { label: t("employees.fields.type"), value: tDynamic(t, `employees.type.${e.type}`) },
                { label: t("employees.fields.postId"), value: locale === "hi" ? e.post.nameHi : e.post.name },
                { label: t("employees.fields.sectionId"), value: locale === "hi" ? e.section.nameHi : e.section.name },
                { label: t("employees.fields.dateOfJoining"), value: formatDate(e.dateOfJoining, locale) },
                { label: t("employees.fields.dateOfRetirement"), value: e.dateOfRetirement ? formatDate(e.dateOfRetirement, locale) : t("employees.profile.noRetirement") },
                { label: t("employees.fields.serviceYears"), value: t("employees.profile.years", { years: e.serviceYears }) },
                ...(e.payLevel
                  ? [
                      { label: t("employees.fields.payLevel"), value: t("employees.level", { level: e.payLevel }) },
                      { label: t("employees.fields.payCell"), value: dash(e.payCell) },
                      {
                        label: t("employees.fields.basicPay"),
                        value: e.basicPay ? (
                          <span>
                            <span className="tabular text-base font-semibold text-brand-800">{formatINR(e.basicPay)}</span>
                            <span className="block text-xs text-ink-500">{t("employees.profile.basicPayHint")}</span>
                          </span>
                        ) : (
                          "—"
                        ),
                      },
                    ]
                  : []),
                ...(e.wageBasis
                  ? [
                      { label: t("employees.fields.agencyName"), value: dash(e.agencyName) },
                      { label: t("employees.fields.wageRate"), value: e.wageRate !== null ? `${formatINR(e.wageRate, { decimals: true })} · ${tDynamic(t, `employees.wageBasis.${e.wageBasis}`)}` : "—" },
                      { label: t("employees.fields.contractStart"), value: `${formatDate(e.contractStart, locale)} – ${formatDate(e.contractEnd, locale)}` },
                    ]
                  : []),
                { label: t("employees.fields.probationEndDate"), value: formatDate(e.probationEndDate, locale) },
                { label: t("employees.fields.confirmationDate"), value: formatDate(e.confirmationDate, locale) },
                { label: t("employees.fields.biometricId"), value: dash(e.biometricId) },
              ]}
            />
          </CardBody>
        </Card>
      )}

      {tab === "ids" && (
        <Card>
          <CardBody>
            {e.ids ? (
              <DescriptionList
                columns={3}
                items={[
                  {
                    label: t("employees.fields.pan"),
                    value: canRevealIds(actor) || mode === "self" ? <RevealValue masked={e.ids.pan} url={`/api/v1/employees/${e.id}/reveal`} field="pan" /> : dash(e.ids.pan),
                  },
                  { label: t("employees.fields.aadhaar"), value: <span className="tabular tracking-wide">{dash(e.ids.aadhaar)}</span> },
                  { label: t("employees.fields.pran"), value: <span className="tabular">{dash(e.ids.pran)}</span> },
                  { label: t("employees.fields.uan"), value: <span className="tabular">{dash(e.ids.uan)}</span> },
                  { label: t("employees.fields.esicNumber"), value: <span className="tabular">{dash(e.ids.esicNumber)}</span> },
                  { label: t("employees.fields.gpfNumber"), value: dash(e.ids.gpfNumber) },
                  {
                    label: t("employees.fields.bankAccount"),
                    value: canRevealIds(actor) || mode === "self" ? <RevealValue masked={e.ids.bankAccount} url={`/api/v1/employees/${e.id}/reveal`} field="bankAccount" /> : dash(e.ids.bankAccount),
                  },
                  { label: t("employees.fields.ifsc"), value: <span className="tabular">{dash(e.ids.ifsc)}</span> },
                  { label: t("employees.fields.bankName"), value: [e.ids.bankName, e.ids.bankBranch].filter(Boolean).join(", ") || "—" },
                ]}
              />
            ) : (
              <p className="text-sm text-ink-500">{t("employees.profile.sensitiveHidden")}</p>
            )}
            <p className="mt-6 text-xs text-ink-400">{t("employees.profile.aadhaarNote")}</p>
          </CardBody>
        </Card>
      )}

      {tab === "family" && <FamilyTab e={e} actor={actor} t={t} locale={locale} />}
      {tab === "documents" && <DocumentsTab e={e} actor={actor} t={t} locale={locale} hr={hr} />}
      {tab === "serviceBook" && <ServiceBookTab e={e} actor={actor} t={t} locale={locale} hr={hr} />}
      {tab === "overview" && mode === "hr" && <OverviewTab e={e} actor={actor} t={t} locale={locale} basePath={basePath} filters={filters} />}
      {tab === "leave" && <LeaveTab e={e} actor={actor} t={t} locale={locale} mode={mode} basePath={basePath} filters={filters} />}
      {tab === "payslips" && <PayslipsTab e={e} actor={actor} t={t} locale={locale} mode={mode} basePath={basePath} filters={filters} />}
      {tab === "history" && mode === "hr" && <HistoryTab e={e} actor={actor} t={t} locale={locale} />}
    </div>
  );
}

async function FamilyTab({ e, actor, t, locale }: { e: EmployeeView; actor: Actor; t: TFunction; locale: Locale }) {
  const { members, nominees } = await getFamily(actor, e.id);
  const byScheme = new Map<string, typeof nominees>();
  for (const n of nominees) byScheme.set(n.scheme, [...(byScheme.get(n.scheme) ?? []), n]);
  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? "—";
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader title={t("employees.family.members")} />
        {members.length === 0 ? (
          <EmptyState title={t("employees.family.empty")} />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>{t("common.name")}</Th>
                <Th>{t("employees.family.relation")}</Th>
                <Th>{t("employees.fields.dateOfBirth")}</Th>
                <Th>{t("common.status")}</Th>
              </tr>
            </THead>
            <tbody>
              {members.map((m) => (
                <Tr key={m.id}>
                  <Td className="font-medium text-ink-900">{locale === "hi" && m.nameHi ? m.nameHi : m.name}</Td>
                  <Td>{tDynamic(t, `employees.relation.${m.relation}`)}</Td>
                  <Td className="text-ink-600">{formatDate(m.dateOfBirth, locale)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {m.isDependent && <Badge tone="blue">{t("employees.family.dependent")}</Badge>}
                      {!m.isAlive && <Badge tone="gray">{t("employees.family.deceased")}</Badge>}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={t("employees.family.nominees")} description={t("employees.family.nomineesHint")} />
        <CardBody className="space-y-4">
          {byScheme.size === 0 ? (
            <p className="text-sm text-ink-500">{t("employees.family.noNominees")}</p>
          ) : (
            [...byScheme.entries()].map(([scheme, list]) => (
              <div key={scheme}>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{tDynamic(t, `employees.scheme.${scheme}`)}</p>
                <ul className="mt-1.5 space-y-1">
                  {list.map((n) => (
                    <li key={n.id} className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 text-sm">
                      <span>{memberName(n.familyMemberId)}</span>
                      <span className="tabular font-medium">{n.sharePercent}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </CardBody>
      </Card>
    </div>
  );
}

async function DocumentsTab({ e, actor, t, locale, hr }: { e: EmployeeView; actor: Actor; t: TFunction; locale: Locale; hr: boolean }) {
  const [docs, settings] = await Promise.all([listDocuments(actor, e.id), getSetting(actor.boardId, "documents")]);
  const types = settings.types.filter((x) => x.active);
  const canOpen = hr || actor.employeeId === e.id || actor.permissions.some((p) => ["CHECKER", "PAYROLL", "PENSION", "APPROVER", "HR"].includes(p));
  return (
    <Card>
      <CardHeader title={t("employees.tabs.documents")} description={t("employees.documents.fileHintTypes")} actions={hr ? <DocumentUpload employeeId={e.id} types={types} /> : undefined} />
      {docs.length === 0 ? (
        <EmptyState icon={<FileText className="size-6" aria-hidden="true" />} title={t("employees.documents.empty")} />
      ) : (
        <ul className="divide-y divide-ink-100">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-4 px-5 py-3 sm:px-6">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <FileText className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                {canOpen ? (
                  <a href={`/api/v1/documents/${d.id}?view=1`} target="_blank" rel="noopener" className="block truncate font-medium text-ink-900 hover:text-brand-700 hover:underline">
                    {d.title}
                  </a>
                ) : (
                  <p className="truncate font-medium text-ink-900">{d.title}</p>
                )}
                <p className="text-xs text-ink-500">
                  {docTypeName(settings.types, d.category, locale)} · {d.size >= 1024 * 1024 ? `${(d.size / 1024 / 1024).toFixed(1)} MB` : `${(d.size / 1024).toFixed(0)} KB`} · {t("employees.documents.uploadedBy", { name: d.uploadedByName })} · {formatDateTime(d.createdAt, locale)}
                </p>
              </div>
              {hr && <DocumentDelete documentId={d.id} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function ServiceBookTab({ e, actor, t, locale, hr }: { e: EmployeeView; actor: Actor; t: TFunction; locale: Locale; hr: boolean }) {
  const [entries, docs, settings] = await Promise.all([listServiceBook(actor, e.id), listDocuments(actor, e.id), getSetting(actor.boardId, "documents")]);
  const scans = docs.filter((d) => d.category === "SERVICE_BOOK");
  const scanType = settings.types.filter((x) => x.code === "SERVICE_BOOK" && x.active);
  const canOpen = hr || actor.employeeId === e.id || actor.permissions.some((p) => ["CHECKER", "PAYROLL", "PENSION", "APPROVER", "HR"].includes(p));
  const tone = { PENDING: "amber", APPROVED: "green", REJECTED: "red" } as const;
  const label = { PENDING: t("employees.serviceBook.pending"), APPROVED: t("employees.serviceBook.approved"), REJECTED: t("employees.serviceBook.rejected") };
  return (
    <div className="space-y-6">
    <Card>
      <CardHeader
        title={t("employees.serviceBookScans.tabTitle")}
        description={t("employees.serviceBookScans.tabHint")}
        icon={<BookOpen className="size-4.5" aria-hidden="true" />}
        actions={hr && scanType.length > 0 ? <DocumentUpload employeeId={e.id} types={scanType} defaultType="SERVICE_BOOK" label={t("employees.serviceBookScans.uploadOne")} /> : undefined}
      />
      {scans.length === 0 ? (
        <CardBody className="text-sm text-ink-500">{t("employees.serviceBookScans.tabEmpty")}</CardBody>
      ) : (
        <ul className="divide-y divide-ink-100">
          {scans.map((d) => (
            <li key={d.id} className="flex items-center gap-4 px-5 py-3 sm:px-6">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <BookOpen className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                {canOpen ? (
                  <a href={`/api/v1/documents/${d.id}?view=1`} target="_blank" rel="noopener" className="block truncate font-medium text-ink-900 hover:text-brand-700 hover:underline">
                    {d.title}
                  </a>
                ) : (
                  <p className="truncate font-medium text-ink-900">{d.title}</p>
                )}
                <p className="text-xs text-ink-500">
                  {(d.size / 1024 / 1024).toFixed(1)} MB · {t("employees.documents.uploadedBy", { name: d.uploadedByName })} · {formatDateTime(d.createdAt, locale)}
                </p>
              </div>
              {hr && <DocumentDelete documentId={d.id} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
    <Card>
      <CardHeader title={t("employees.tabs.serviceBook")} actions={hr && canAll(actor, "service_book", "create") ? <ServiceEntryDialog employeeId={e.id} /> : undefined} />
      {entries.length === 0 ? (
        <EmptyState icon={<History className="size-6" aria-hidden="true" />} title={t("employees.serviceBook.empty")} />
      ) : (
        <ol className="relative px-5 py-5 sm:px-6">
          <span className="absolute bottom-6 left-[2.29rem] top-6 w-px bg-ink-200 sm:left-[2.54rem]" aria-hidden="true" />
          {entries.map((s) => (
            <li key={s.id} className="relative flex gap-4 pb-6 last:pb-0">
              <span className={`relative z-[1] mt-1 size-3.5 shrink-0 rounded-full ring-4 ring-white ${s.status === "APPROVED" ? "bg-brand-600" : s.status === "PENDING" ? "bg-amber-500" : "bg-ink-300"}`} style={{ marginLeft: "0.6rem" }} />
              <div className="min-w-0 flex-1 rounded-xl border border-ink-200/80 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-ink-900">
                    {tDynamic(t, `employees.event.${s.event}`)} <span className="font-normal text-ink-500">· {formatDate(s.eventDate, locale)}</span>
                  </p>
                  <Badge tone={tone[s.status]}>{label[s.status]}</Badge>
                </div>
                <p className="mt-1.5 text-sm text-ink-700">{locale === "hi" && s.detailsHi ? s.detailsHi : s.details}</p>
                {(s.orderNumber || s.documentId) && (
                  <p className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-500">
                    {s.orderNumber && (
                      <span>
                        {t("employees.serviceBook.orderNo")}: {s.orderNumber}
                        {s.orderDate ? ` · ${formatDate(s.orderDate, locale)}` : ""}
                      </span>
                    )}
                    {s.documentId && (
                      <a href={`/api/v1/documents/${s.documentId}?view=1`} target="_blank" rel="noopener" className="font-medium text-brand-700 hover:underline">
                        {t("employees.serviceBook.viewOrder")}
                      </a>
                    )}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
    </div>
  );
}

async function HistoryTab({ e, actor, t, locale }: { e: EmployeeView; actor: Actor; t: TFunction; locale: Locale }) {
  const rows = await fieldHistory(actor, e.id);
  return (
    <Card>
      {rows.length === 0 ? (
        <EmptyState icon={<History className="size-6" aria-hidden="true" />} title={t("employees.history.empty")} />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>{t("audit.when")}</Th>
              <Th>{t("approvals.field")}</Th>
              <Th>{t("audit.oldValue")}</Th>
              <Th>{t("audit.newValue")}</Th>
              <Th>{t("audit.who")}</Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap text-ink-600">{formatDateTime(r.createdAt, locale)}</Td>
                <Td className="font-medium">{tDynamic(t, `employees.fields.${r.field}`)}</Td>
                <Td className="text-ink-500">{r.oldValue ?? "—"}</Td>
                <Td className="font-medium text-ink-900">{r.newValue ?? "—"}</Td>
                <Td className="text-xs text-ink-500">{t("employees.history.by", { maker: r.changedBy ?? "—", checker: r.approvedBy ?? "—" })}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

type TabProps = { e: EmployeeView; actor: Actor; t: TFunction; locale: Locale };
const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Client add-on: the whole person on one screen — service, leave, attendance, salary, payslips, loans, GPF. */
async function OverviewTab({ e, actor, t, locale, basePath, filters }: TabProps & { basePath: string; filters: Filters }) {
  const today = todayIST();
  const period = parsePeriod(filters, { today, doj: e.dateOfJoining });
  // "Year" with no year chosen yet opens this financial year.
  const chosen: Period | null = period ?? (filters.view === "year" ? { view: "year", fy: fyList(e.dateOfJoining, today)[0] } : null);
  const o = await employeeOverview(actor, e.id, chosen);
  const last = o.pay?.last;
  const bar = <PeriodBar basePath={basePath} period={chosen} doj={e.dateOfJoining} today={today} t={t} locale={locale} />;
  if (chosen?.view === "year") return <YearView e={e} o={o} t={t} locale={locale} basePath={basePath} bar={bar} />;
  return (
    <div className="space-y-6">
      {bar}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t("employees.overview.service")}
          value={t("employees.overview.serviceValue", { years: o.facts.service.years, months: o.facts.service.months })}
          hint={t("employees.overview.joined", { date: formatDate(e.dateOfJoining, locale) })}
          icon={<BriefcaseBusiness className="size-4.5" aria-hidden="true" />}
        />
        <StatTile
          label={t("employees.overview.retires")}
          value={e.dateOfRetirement ? formatDate(e.dateOfRetirement, locale) : "—"}
          hint={o.facts.toRetirement ? t("employees.overview.retiresIn", o.facts.toRetirement) : !e.dateOfRetirement ? t("employees.overview.noRetirement") : undefined}
          icon={<CalendarClock className="size-4.5" aria-hidden="true" />}
          tone={o.facts.toRetirement && o.facts.toRetirement.years === 0 ? "amber" : "green"}
        />
        {e.basicPay !== null ? (
          <StatTile label={t("employees.overview.basic")} value={formatINR(e.basicPay)} hint={t("employees.overview.levelCell", { level: e.payLevel ?? "—", cell: e.payCell ?? "—" })} icon={<IndianRupee className="size-4.5" aria-hidden="true" />} />
        ) : e.wageRate !== null ? (
          <StatTile label={t("employees.overview.wage")} value={formatINR(e.wageRate)} icon={<IndianRupee className="size-4.5" aria-hidden="true" />} />
        ) : (
          <StatTile label={t("employees.overview.basic")} value="—" icon={<IndianRupee className="size-4.5" aria-hidden="true" />} tone="gray" />
        )}
        {last ? (
          <StatTile
            label={chosen ? t("employees.overview.netFor", { month: formatMonth(last.month, locale) }) : t("employees.overview.lastNet")}
            value={formatINR(last.net)}
            hint={t("employees.overview.lastNetHint", { month: formatMonth(last.month, locale), gross: formatINR(last.gross) })}
            icon={<Wallet className="size-4.5" aria-hidden="true" />}
            href={`${basePath}?tab=payslips`}
          />
        ) : (
          <StatTile label={t("employees.overview.lastNet")} value="—" hint={o.pay ? t("employees.overview.salaryNone") : t("employees.overview.payHidden")} icon={<Wallet className="size-4.5" aria-hidden="true" />} tone="gray" />
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {o.leave && (
          <Card>
            <CardHeader
              title={t("employees.overview.leave")}
              icon={<CalendarDays className="size-4.5" aria-hidden="true" />}
              actions={
                <Link href={`/leave/ledger/${e.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                  {t("employees.overview.ledger")}
                </Link>
              }
            />
            <CardBody>
              {o.leave.balances.length === 0 ? (
                <p className="text-sm text-ink-500">{t("employees.overview.leaveNone")}</p>
              ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="overview-leave">
                  {o.leave.balances.map((b) => (
                    <li key={b.code} className="rounded-xl border border-ink-100 px-3 py-2.5">
                      <p className="text-xs font-medium text-ink-500">
                        {b.code} · {locale === "hi" ? b.nameHi : b.name}
                      </p>
                      <p className="tabular mt-0.5 text-xl font-semibold text-ink-950">{b.balance === null ? "—" : days(b.balance)}</p>
                      {b.pending > 0 && <p className="text-xs text-amber-700">{t("employees.overview.leaveWaiting", { days: days(b.pending) })}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {chosen?.view === "month" && o.leave.taken && (
                <div className="mt-4 border-t border-ink-100 pt-3" data-testid="overview-leave-taken">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t("employees.overview.takenIn", { period: formatMonth(chosen.month, locale) })}</p>
                  {o.leave.applications.length === 0 ? (
                    <p className="mt-1 text-sm text-ink-500">{t("employees.overview.noLeaveTaken")}</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-sm">
                      {o.leave.applications.map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-ink-800">
                            <b>{a.code}</b> · {formatDate(a.from, locale)}
                            {a.to !== a.from && ` – ${formatDate(a.to, locale)}`} · {t("employees.overview.daysCount", { days: days(a.days) })}
                          </span>
                          <Badge tone={LEAVE_TONE[a.status]}>{tDynamic(t, `leave.status.${a.status}`)}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        )}
        <Card>
          <CardHeader title={o.attendance ? t("employees.overview.attendance", { month: formatMonth(o.attendance.month, locale) }) : t("employees.overview.attendance", { month: chosen?.view === "month" ? formatMonth(chosen.month, locale) : "—" })} icon={<CalendarCheck className="size-4.5" aria-hidden="true" />} />
          <CardBody>
            {o.attendance ? (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {(
                  [
                    ["present", o.attendance.present],
                    ["onLeave", o.attendance.leave],
                    ["late", o.attendance.late],
                    ["diesNon", o.attendance.absentOrDiesNon],
                    ["payable", o.attendance.payableDays],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-ink-50 px-3 py-2.5">
                    <dt className="text-xs text-ink-500">{t(`employees.overview.${k}`)}</dt>
                    <dd className="tabular mt-0.5 text-lg font-semibold text-ink-950">{days(v)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-ink-500">{t("employees.overview.noAttendance")}</p>
            )}
          </CardBody>
        </Card>
      </div>

      {o.pay ? (
        <Card data-testid="overview-salary">
          <CardHeader
            title={last ? t("employees.overview.salary", { month: formatMonth(last.month, locale) }) : t("employees.overview.salary", { month: chosen?.view === "month" ? formatMonth(chosen.month, locale) : "—" })}
            description={t("employees.overview.year", { fy: o.pay.year.fy, count: o.pay.year.slips, gross: formatINR(o.pay.year.gross), deductions: formatINR(o.pay.year.deductions), net: formatINR(o.pay.year.net) })}
            icon={<Receipt className="size-4.5" aria-hidden="true" />}
            actions={
              <Link href={`${basePath}?tab=payslips`} className="text-sm font-medium text-brand-700 hover:underline">
                {t("employees.overview.allSlips")}
              </Link>
            }
          />
          {last ? (
            <CardBody className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {(["EARNING", "DEDUCTION"] as const).map((kind) => {
                const lines = last.lines.filter((l) => l.kind === kind);
                return (
                  <div key={kind}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{t(kind === "EARNING" ? "employees.overview.earnings" : "employees.overview.deductions")}</p>
                    <ul className="divide-y divide-ink-100 text-sm">
                      {lines.map((l) => (
                        <li key={l.code} className="flex justify-between gap-3 py-1.5">
                          <span className="text-ink-700">{locale === "hi" ? l.nameHi : l.name}</span>
                          <span className="tabular font-medium text-ink-900">{formatINR(l.amount)}</span>
                        </li>
                      ))}
                      <li className="flex justify-between gap-3 py-1.5 font-semibold">
                        <span>{t(kind === "EARNING" ? "employees.overview.gross" : "employees.overview.deductions")}</span>
                        <span className="tabular">{formatINR(kind === "EARNING" ? last.gross : last.deductions)}</span>
                      </li>
                    </ul>
                  </div>
                );
              })}
              <div className="flex items-baseline justify-between rounded-xl bg-brand-900 px-4 py-3 text-white md:col-span-2">
                <span className="font-medium">{t("employees.overview.net")}</span>
                <span className="tabular text-2xl font-semibold">{formatINR(last.net)}</span>
              </div>
            </CardBody>
          ) : (
            <CardBody className="text-sm text-ink-500">{chosen?.view === "month" ? t("employees.overview.salaryNoneFor", { month: formatMonth(chosen.month, locale) }) : t("employees.overview.salaryNone")}</CardBody>
          )}
          {o.pay.alsoPaid.length > 0 && (
            <CardBody className="border-t border-ink-100">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{t("employees.overview.alsoPaid")}</p>
              <ul className="space-y-1 text-sm">
                {o.pay.alsoPaid.map((x) => (
                  <li key={x.id} className="flex justify-between gap-3">
                    <span className="text-ink-700">{locale === "hi" ? x.titleHi : x.title}</span>
                    <span className="tabular font-medium text-ink-900">{formatINR(x.net)}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          )}
        </Card>
      ) : (
        <p className="rounded-xl border border-ink-100 bg-white px-4 py-3 text-sm text-ink-600">{t("employees.overview.payHidden")}</p>
      )}

      {(o.loans || o.gpf) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {o.loans && (
            <Card>
              <CardHeader title={t("employees.overview.loans")} icon={<HandCoins className="size-4.5" aria-hidden="true" />} />
              {o.loans.length === 0 ? (
                <CardBody className="text-sm text-ink-500">{t("employees.overview.noLoans")}</CardBody>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {o.loans.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6">
                      <div className="min-w-0">
                        <p className="font-medium text-ink-900">{tDynamic(t, `payroll.loans.types.${l.type}`)}{l.purpose ? ` — ${l.purpose}` : ""}</p>
                        <p className="text-xs text-ink-500">{t("employees.overview.loanLeft", { left: formatINR(l.left), instalment: formatINR(l.instalmentAmount) })}</p>
                      </div>
                      <Link href={`/payroll/loans/${l.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                        {t("employees.overview.open")}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {o.gpf && (
            <Card>
              <CardHeader title={t("employees.overview.gpf")} icon={<PiggyBank className="size-4.5" aria-hidden="true" />} actions={<Link href={`/statutory/funds/${e.id}`} className="text-sm font-medium text-brand-700 hover:underline">{t("employees.overview.open")}</Link>} />
              <CardBody>
                <p className="tabular text-2xl font-semibold text-ink-950">{formatINR(o.gpf.balance)}</p>
                {o.gpf.advanceLeft > 0 && <p className="mt-1 text-sm text-amber-700">{t("employees.overview.gpfAdvance", { amount: formatINR(o.gpf.advanceLeft) })}</p>}
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

async function LeaveTab({ e, actor, t, locale, basePath, filters }: TabProps & { mode: "hr" | "self"; basePath: string; filters: Filters }) {
  const today = todayIST();
  const years = yearList(e.dateOfJoining, today);
  const year = filters.year && years.includes(Number(filters.year)) ? Number(filters.year) : null;
  const [o, list] = await Promise.all([employeeOverview(actor, e.id), leaveApplicationsOf(actor, e.id, year)]);
  if (!o.leave || !list) return <Card><CardBody className="text-sm text-ink-500">{t("employees.leaveTab.noAccess")}</CardBody></Card>;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={t("employees.overview.leave")}
          icon={<CalendarDays className="size-4.5" aria-hidden="true" />}
          actions={
            <Link href={actor.employeeId === e.id ? "/leave/ledger/me" : `/leave/ledger/${e.id}`} className="text-sm font-medium text-brand-700 hover:underline">
              {t("employees.overview.ledger")}
            </Link>
          }
        />
        <Table stack>
          <THead>
            <tr>
              <Th>{t("employees.leaveTab.code")}</Th>
              <Th align="right">{t("employees.leaveTab.balance")}</Th>
              <Th align="right">{t("employees.leaveTab.waiting")}</Th>
              <Th align="right">{t("employees.leaveTab.available")}</Th>
            </tr>
          </THead>
          <tbody>
            {o.leave.balances.map((b) => (
              <Tr key={b.code}>
                <Td className="font-medium text-ink-900">
                  {b.code} · {locale === "hi" ? b.nameHi : b.name}
                </Td>
                <Td label={t("employees.leaveTab.balance")} align="right">{b.balance === null ? "—" : days(b.balance)}</Td>
                <Td label={t("employees.leaveTab.waiting")} align="right">{b.pending ? days(b.pending) : "—"}</Td>
                <Td label={t("employees.leaveTab.available")} align="right" className="font-semibold">{b.available === null ? "—" : days(b.available)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card>
        <CardHeader
          title={year ? t("employees.leaveTab.inYear", { year }) : t("employees.leaveTab.recent")}
          description={year && list.taken.length ? t("employees.leaveTab.takenSummary", { list: list.taken.map((x) => `${x.code} ${days(x.days)}`).join(" · ") }) : undefined}
          actions={
            <form method="get" action={basePath} className="flex items-center gap-2">
              <input type="hidden" name="tab" value="leave" />
              <select name="year" defaultValue={year ?? ""} aria-label={t("employees.period.year")} className={controlClass(false, "h-9 w-auto")}>
                <option value="">{t("employees.leaveTab.latest")}</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <button type="submit" className={buttonClass("secondary", "sm")}>
                {t("employees.period.show")}
              </button>
            </form>
          }
        />
        {list.applications.length === 0 ? (
          <CardBody className="text-sm text-ink-500">{t("employees.leaveTab.noApplications")}</CardBody>
        ) : (
          <Table stack>
            <THead>
              <tr>
                <Th>{t("employees.leaveTab.code")}</Th>
                <Th>{t("employees.leaveTab.dates")}</Th>
                <Th align="right">{t("employees.leaveTab.days")}</Th>
                <Th>{t("employees.leaveTab.status")}</Th>
              </tr>
            </THead>
            <tbody>
              {list.applications.map((a) => (
                <Tr key={a.id}>
                  <Td className="font-medium text-ink-900">{a.code}</Td>
                  <Td label={t("employees.leaveTab.dates")}>
                    {formatDate(a.from, locale)}
                    {a.to !== a.from && ` – ${formatDate(a.to, locale)}`}
                  </Td>
                  <Td label={t("employees.leaveTab.days")} align="right">{days(a.days)}</Td>
                  <Td label={t("employees.leaveTab.status")}>
                    <Badge tone={LEAVE_TONE[a.status]} dot>
                      {tDynamic(t, `leave.status.${a.status}`)}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

async function PayslipsTab({ e, actor, t, locale, mode, basePath, filters }: TabProps & { mode: "hr" | "self"; basePath: string; filters: Filters }) {
  const fys = fyList(e.dateOfJoining, todayIST());
  const fy = filters.fy && fys.includes(filters.fy) ? filters.fy : null;
  const all = mode === "self" ? (await myPayslips(actor)).filter((s) => !fy || monthsOfFy(fy).includes(s.month)) : await payslipsOf(actor, e.id, fy);
  if (!all) return <Card><CardBody className="text-sm text-ink-500">{t("employees.overview.payHidden")}</CardBody></Card>;
  const slips = all;
  const total = (k: "gross" | "deductions" | "net") => slips.reduce((t2, s) => t2 + Math.round(s[k] * 100), 0) / 100;
  return (
    <Card>
      <CardHeader
        title={fy ? t("employees.payslipsTab.inFy", { fy }) : t("employees.tabs.payslips")}
        icon={<Receipt className="size-4.5" aria-hidden="true" />}
        actions={
          <form method="get" action={basePath} className="flex items-center gap-2">
            <input type="hidden" name="tab" value="payslips" />
            <select name="fy" defaultValue={fy ?? ""} aria-label={t("employees.period.fy")} className={controlClass(false, "h-9 w-auto")}>
              <option value="">{t("employees.payslipsTab.allYears")}</option>
              {fys.map((y) => (
                <option key={y} value={y}>
                  {t("employees.period.fyLabel", { fy: y })}
                </option>
              ))}
            </select>
            <button type="submit" className={buttonClass("secondary", "sm")}>
              {t("employees.period.show")}
            </button>
          </form>
        }
      />
      {slips.length === 0 ? (
        <EmptyState icon={<Receipt className="size-6" aria-hidden="true" />} title={t("employees.payslipsTab.empty")} />
      ) : (
        <Table stack>
          <THead>
            <tr>
              <Th>{t("employees.payslipsTab.month")}</Th>
              <Th>{t("employees.payslipsTab.bill")}</Th>
              <Th align="right">{t("employees.payslipsTab.gross")}</Th>
              <Th align="right">{t("employees.payslipsTab.deductions")}</Th>
              <Th align="right">{t("employees.payslipsTab.net")}</Th>
              <Th>{t("employees.payslipsTab.pdf")}</Th>
            </tr>
          </THead>
          <tbody>
            {slips.map((s) => (
              <Tr key={s.id}>
                <Td className="whitespace-nowrap font-medium text-ink-900">{formatMonth(s.month, locale)}</Td>
                <Td label={t("employees.payslipsTab.bill")} className="text-sm text-ink-600">
                  {locale === "hi" ? s.titleHi : s.title}
                  {s.creditStatus && s.creditStatus !== "CREDITED" && (
                    <Badge tone={s.creditStatus === "FAILED" ? "red" : "blue"} className="ml-2">
                      {tDynamic(t, `payroll.credit.${s.creditStatus}`)}
                    </Badge>
                  )}
                </Td>
                <Td label={t("employees.payslipsTab.gross")} align="right">{formatINR(s.gross)}</Td>
                <Td label={t("employees.payslipsTab.deductions")} align="right">{formatINR(s.deductions)}</Td>
                <Td label={t("employees.payslipsTab.net")} align="right" className="font-semibold">{formatINR(s.net)}</Td>
                <Td label={t("employees.payslipsTab.pdf")}>
                  <a href={`/api/v1/payslips/${s.id}/pdf?lang=${locale}`} target="_blank" rel="noopener" className="text-sm font-medium text-brand-700 hover:underline">
                    {t("employees.payslipsTab.pdf")}
                  </a>
                </Td>
              </Tr>
            ))}
            {fy && (
              <Tr className="bg-ink-50/70 font-semibold" data-testid="payslips-total">
                <Td className="text-ink-900">{t("employees.payslipsTab.total", { count: slips.length })}</Td>
                <Td label={t("employees.payslipsTab.bill")}>{t("employees.period.fyLabel", { fy })}</Td>
                <Td label={t("employees.payslipsTab.gross")} align="right">{formatINR(total("gross"))}</Td>
                <Td label={t("employees.payslipsTab.deductions")} align="right">{formatINR(total("deductions"))}</Td>
                <Td label={t("employees.payslipsTab.net")} align="right">{formatINR(total("net"))}</Td>
                <Td label={t("employees.payslipsTab.pdf")}> </Td>
              </Tr>
            )}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

/** "Show for": the latest month, a chosen month, or a chosen financial year (April to March). */
function PeriodBar({ basePath, period, doj, today, t, locale }: { basePath: string; period: Period | null; doj: string; today: string; t: TFunction; locale: Locale }) {
  const year = period?.view === "year";
  const fys = fyList(doj, today);
  const pill = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${active ? "bg-white text-brand-800 shadow-sm ring-1 ring-ink-200" : "text-ink-600 hover:text-ink-900"}`;
  return (
    <Card>
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:px-6" data-testid="period-bar">
        <span className="text-sm font-medium text-ink-700">{t("employees.period.showFor")}</span>
        <div className="inline-flex w-fit rounded-full bg-ink-100 p-1" role="group" aria-label={t("employees.period.showFor")}>
          <Link href={`${basePath}?tab=overview`} className={pill(!year)} aria-current={!year ? "true" : undefined}>
            {t("employees.period.month")}
          </Link>
          <Link href={`${basePath}?tab=overview&view=year&fy=${period?.view === "year" ? period.fy : fys[0]}`} className={pill(year)} aria-current={year ? "true" : undefined}>
            {t("employees.period.year")}
          </Link>
        </div>
        <form method="get" action={basePath} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tab" value="overview" />
          {year ? (
            <>
              <input type="hidden" name="view" value="year" />
              <select name="fy" defaultValue={period.fy} aria-label={t("employees.period.fy")} className={controlClass(false, "h-9 w-auto")}>
                {fys.map((y) => (
                  <option key={y} value={y}>
                    {t("employees.period.fyLabel", { fy: y })}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <input type="month" name="month" defaultValue={period?.view === "month" ? period.month : ""} min={doj.slice(0, 7)} max={today.slice(0, 7)} aria-label={t("employees.period.month")} className={controlClass(false, "h-9 w-auto")} />
          )}
          <button type="submit" className={buttonClass("secondary", "sm")}>
            {t("employees.period.show")}
          </button>
        </form>
        <p className="text-xs text-ink-500 sm:ml-auto">
          {period?.view === "month" ? t("employees.period.showingMonth", { month: formatMonth(period.month, locale) }) : period?.view === "year" ? t("employees.period.showingYear", { fy: period.fy }) : t("employees.period.showingLatest")}
        </p>
      </div>
    </Card>
  );
}

/** A financial year at a glance: pay month by month (regular and supplementary bills) with attendance, the year's
 * deductions, and leave taken. */
function YearView({ e, o, t, locale, basePath, bar }: { e: EmployeeView; o: Awaited<ReturnType<typeof employeeOverview>>; t: TFunction; locale: Locale; basePath: string; bar: React.ReactNode }) {
  const y = o.pay?.year;
  return (
    <div className="space-y-6">
      {bar}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t("employees.overview.service")} value={t("employees.overview.serviceValue", { years: o.facts.service.years, months: o.facts.service.months })} hint={t("employees.overview.joined", { date: formatDate(e.dateOfJoining, locale) })} icon={<BriefcaseBusiness className="size-4.5" aria-hidden="true" />} />
        <StatTile label={t("employees.overview.yearNet", { fy: o.fy })} value={y ? formatINR(y.net) : "—"} hint={y ? t("employees.overview.yearNetHint", { count: y.slips, gross: formatINR(y.gross) }) : t("employees.overview.payHidden")} icon={<Wallet className="size-4.5" aria-hidden="true" />} tone={y ? "green" : "gray"} />
        <StatTile label={t("employees.overview.yearTax")} value={y ? formatINR(y.tax) : "—"} icon={<Receipt className="size-4.5" aria-hidden="true" />} tone={y ? "blue" : "gray"} />
        <StatTile label={t("employees.overview.yearLeave")} value={o.leave?.taken ? days(o.leave.taken.reduce((t2, x) => t2 + x.days, 0)) : "—"} hint={o.leave?.taken?.length ? o.leave.taken.map((x) => `${x.code} ${days(x.days)}`).join(" · ") : undefined} icon={<CalendarDays className="size-4.5" aria-hidden="true" />} tone="gray" />
      </div>

      {o.pay?.months ? (
        <Card data-testid="overview-year">
          <CardHeader
            title={t("employees.overview.yearTitle", { fy: o.fy })}
            description={t("employees.overview.yearHelp")}
            icon={<Receipt className="size-4.5" aria-hidden="true" />}
            actions={
              <Link href={`${basePath}?tab=payslips&fy=${o.fy}`} className="text-sm font-medium text-brand-700 hover:underline">
                {t("employees.overview.allSlips")}
              </Link>
            }
          />
          <Table stack>
            <THead>
              <tr>
                <Th>{t("employees.payslipsTab.month")}</Th>
                <Th align="right">{t("employees.payslipsTab.gross")}</Th>
                <Th align="right">{t("employees.payslipsTab.deductions")}</Th>
                <Th align="right">{t("employees.payslipsTab.net")}</Th>
                <Th align="right">{t("employees.overview.present")}</Th>
                <Th align="right">{t("employees.overview.onLeave")}</Th>
                <Th align="right">{t("employees.overview.diesNon")}</Th>
              </tr>
            </THead>
            <tbody>
              {o.pay.months.map((m) => (
                <Tr key={m.month}>
                  <Td className="whitespace-nowrap font-medium text-ink-900">
                    <Link href={`${basePath}?tab=overview&month=${m.month}`} className="hover:text-brand-700 hover:underline">
                      {formatMonth(m.month, locale)}
                    </Link>
                    {m.bills > 1 && <span className="ml-2 text-xs font-normal text-ink-500">{t("employees.overview.bills", { count: m.bills })}</span>}
                  </Td>
                  <Td label={t("employees.payslipsTab.gross")} align="right">{m.bills ? formatINR(m.gross) : "—"}</Td>
                  <Td label={t("employees.payslipsTab.deductions")} align="right">{m.bills ? formatINR(m.deductions) : "—"}</Td>
                  <Td label={t("employees.payslipsTab.net")} align="right" className="font-semibold">{m.bills ? formatINR(m.net) : "—"}</Td>
                  <Td label={t("employees.overview.present")} align="right">{m.attendance ? days(m.attendance.present) : "—"}</Td>
                  <Td label={t("employees.overview.onLeave")} align="right">{m.attendance ? days(m.attendance.leave) : "—"}</Td>
                  <Td label={t("employees.overview.diesNon")} align="right">{m.attendance ? days(m.attendance.absentOrDiesNon) : "—"}</Td>
                </Tr>
              ))}
              {y && (
                <Tr className="bg-ink-50/70 font-semibold">
                  <Td className="text-ink-900">{t("employees.overview.yearTotal")}</Td>
                  <Td label={t("employees.payslipsTab.gross")} align="right">{formatINR(y.gross)}</Td>
                  <Td label={t("employees.payslipsTab.deductions")} align="right">{formatINR(y.deductions)}</Td>
                  <Td label={t("employees.payslipsTab.net")} align="right">{formatINR(y.net)}</Td>
                  <Td label={t("employees.overview.present")} align="right">{days(o.pay.months.reduce((t2, m) => t2 + (m.attendance?.present ?? 0), 0))}</Td>
                  <Td label={t("employees.overview.onLeave")} align="right">{days(o.pay.months.reduce((t2, m) => t2 + (m.attendance?.leave ?? 0), 0))}</Td>
                  <Td label={t("employees.overview.diesNon")} align="right">{days(o.pay.months.reduce((t2, m) => t2 + (m.attendance?.absentOrDiesNon ?? 0), 0))}</Td>
                </Tr>
              )}
            </tbody>
          </Table>
          {y && (
            <CardBody className="grid grid-cols-1 gap-3 border-t border-ink-100 sm:grid-cols-3">
              {(
                [
                  ["yearTax", y.tax],
                  ["yearFunds", y.funds],
                  ["yearLoans", y.loans],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-xl bg-ink-50 px-3 py-2.5">
                  <p className="text-xs text-ink-500">{t(`employees.overview.${k}`)}</p>
                  <p className="tabular mt-0.5 text-lg font-semibold text-ink-950">{formatINR(v)}</p>
                </div>
              ))}
            </CardBody>
          )}
        </Card>
      ) : (
        <p className="rounded-xl border border-ink-100 bg-white px-4 py-3 text-sm text-ink-600">{t("employees.overview.payHidden")}</p>
      )}

      {o.leave && (
        <Card>
          <CardHeader title={t("employees.overview.leaveInYear", { fy: o.fy })} icon={<CalendarDays className="size-4.5" aria-hidden="true" />} />
          {o.leave.applications.length === 0 ? (
            <CardBody className="text-sm text-ink-500">{t("employees.overview.noLeaveTaken")}</CardBody>
          ) : (
            <Table stack>
              <THead>
                <tr>
                  <Th>{t("employees.leaveTab.code")}</Th>
                  <Th>{t("employees.leaveTab.dates")}</Th>
                  <Th align="right">{t("employees.leaveTab.days")}</Th>
                  <Th>{t("employees.leaveTab.status")}</Th>
                </tr>
              </THead>
              <tbody>
                {o.leave.applications.map((a) => (
                  <Tr key={a.id}>
                    <Td className="font-medium text-ink-900">{a.code}</Td>
                    <Td label={t("employees.leaveTab.dates")}>
                      {formatDate(a.from, locale)}
                      {a.to !== a.from && ` – ${formatDate(a.to, locale)}`}
                    </Td>
                    <Td label={t("employees.leaveTab.days")} align="right">{days(a.days)}</Td>
                    <Td label={t("employees.leaveTab.status")}>
                      <Badge tone={LEAVE_TONE[a.status]} dot>
                        {tDynamic(t, `leave.status.${a.status}`)}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
