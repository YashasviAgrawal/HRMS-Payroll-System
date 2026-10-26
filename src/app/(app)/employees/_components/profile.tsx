import { CalendarClock, CalendarDays, Clock, FileText, History, Hourglass, Pencil, Phone, Receipt, ShieldAlert, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, DescriptionList } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkTabs } from "@/components/ui/tabs";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/dates";
import { tDynamic, type TFunction } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/types";
import { formatINR } from "@/lib/money";
import { getFamily, listDocuments, listServiceBook } from "@/modules/employees/records";
import { addressLine } from "@/modules/employees/present";
import { canRevealIds, fieldHistory, pendingChanges, type EmployeeView } from "@/modules/employees/service";
import { statusTone, typeTone } from "./tones";
import { DocumentDelete, DocumentUpload, RevealValue, ServiceEntryDialog, WithdrawButton } from "./widgets";

export const PROFILE_TABS = ["personal", "job", "ids", "family", "documents", "serviceBook", "leave", "payslips", "history"] as const;
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
}

const dash = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

export async function EmployeeProfile({ e, actor, tab, t, locale, mode, basePath }: Props) {
  const hr = mode === "hr" && canAll(actor, "employee_master", "create") && e.id !== actor.employeeId;
  const pending = await pendingChanges(actor, e.id);
  const name = locale === "hi" && e.nameHi ? e.nameHi : e.name;
  const tabs = PROFILE_TABS.filter((x) => mode === "hr" || x !== "history").map((key) => ({
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
              {hr && EDITABLE.includes(tab) && (
                <LinkButton href={`/employees/${e.id}/edit?tab=${tab}`} size="sm" variant="primary" icon={<Pencil className="size-4" aria-hidden="true" />}>
                  {t("employees.profile.edit")}
                </LinkButton>
              )}
            </div>
          </div>
          <dl className="mt-5 grid gap-4 border-t border-ink-100 pt-5 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { icon: Users, label: t("employees.fields.postId"), value: `${locale === "hi" ? e.post.nameHi : e.post.name}` },
              { icon: CalendarDays, label: t("employees.fields.sectionId"), value: locale === "hi" ? e.section.nameHi : e.section.name },
              { icon: Clock, label: t("employees.fields.dateOfJoining"), value: `${formatDate(e.dateOfJoining, locale)} · ${t("employees.profile.years", { years: e.serviceYears })}` },
              { icon: CalendarClock, label: t("employees.fields.dateOfRetirement"), value: e.dateOfRetirement ? formatDate(e.dateOfRetirement, locale) : t("employees.profile.noRetirement") },
              { icon: Phone, label: t("employees.fields.mobile"), value: dash(e.mobile) },
            ].map((f) => (
              <div key={f.label} className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink-50 text-ink-500">
                  <f.icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <dt className="text-xs text-ink-500">{f.label}</dt>
                  <dd className="truncate text-sm font-medium text-ink-900">{f.value}</dd>
                </div>
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
            <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
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
      {tab === "leave" && (
        <Card>
          <EmptyState icon={<CalendarDays className="size-6" aria-hidden="true" />} title={t("employees.tabs.leave")} description={t("employees.profile.comingLeave")} />
        </Card>
      )}
      {tab === "payslips" && (
        <Card>
          <EmptyState icon={<Receipt className="size-6" aria-hidden="true" />} title={t("employees.tabs.payslips")} description={t("employees.profile.comingPayslips")} />
        </Card>
      )}
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
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
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
  const docs = await listDocuments(actor, e.id);
  const canOpen = hr || actor.employeeId === e.id || actor.permissions.some((p) => ["CHECKER", "PAYROLL", "PENSION", "APPROVER", "HR"].includes(p));
  return (
    <Card>
      <CardHeader title={t("employees.tabs.documents")} description={t("employees.documents.fileHint")} actions={hr ? <DocumentUpload employeeId={e.id} /> : undefined} />
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
                  {tDynamic(t, `employees.docCategory.${d.category}`)} · {(d.size / 1024).toFixed(0)} KB · {t("employees.documents.uploadedBy", { name: d.uploadedByName })} · {formatDateTime(d.createdAt, locale)}
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
  const entries = await listServiceBook(actor, e.id);
  const tone = { PENDING: "amber", APPROVED: "green", REJECTED: "red" } as const;
  const label = { PENDING: t("employees.serviceBook.pending"), APPROVED: t("employees.serviceBook.approved"), REJECTED: t("employees.serviceBook.rejected") };
  return (
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
