"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, FileText, Megaphone, Plus, Send, Upload, UserPlus, XCircle } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select, controlClass } from "@/components/ui/field";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/dates";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { APPLICANT_STATUSES, RESERVATION_CATEGORIES } from "@/modules/recruitment/schema";
import { msg } from "../../../employees/_components/fields";
import { useAction } from "../../widgets";

const STATUS_TONE: Record<string, Tone> = { APPLIED: "gray", ELIGIBLE: "blue", SHORTLISTED: "violet", SELECTED: "green", WAITLISTED: "amber", REJECTED: "red" };

export function VacancyActions({ vacancyId, status, advert }: { vacancyId: string; status: string; advert: { advertNumber: string; advertDate: string; lastDate: string } }) {
  const { t } = useI18n();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(advert);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const toast = useToast();
  const router = useRouter();
  const openStatus = ["APPROVED", "ADVERTISED"].includes(status);
  return (
    <>
      {status === "APPROVED" && (
        <Button size="sm" variant="primary" icon={<Megaphone className="size-4" />} onClick={() => setOpen(true)}>
          {t("recruitment.markAdvertised")}
        </Button>
      )}
      {openStatus && (
        <Button
          size="sm"
          variant="danger"
          icon={<XCircle className="size-4" />}
          loading={busy === "close"}
          onClick={() => window.confirm(t("recruitment.closeConfirm")) && run("close", `/api/v1/recruitment/vacancies/${vacancyId}/close`, { cancel: false }, t("common.saved"))}
        >
          {t("recruitment.close")}
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("recruitment.markAdvertised")}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              loading={busy === "adv"}
              onClick={async () => {
                setErrors({});
                try {
                  await api(`/api/v1/recruitment/vacancies/${vacancyId}/advertise`, { body: a });
                  toast(t("recruitment.advertised"));
                  setOpen(false);
                  router.refresh();
                } catch (err) {
                  if (err instanceof ApiError) {
                    setErrors(err.fields);
                    toast(err.message, "error");
                  }
                }
              }}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label={t("recruitment.advertNumber")} value={a.advertNumber} onChange={(e) => setA({ ...a, advertNumber: e.target.value })} error={msg(t, errors.advertNumber)} required />
          <Input label={t("recruitment.advertDate")} type="date" value={a.advertDate} onChange={(e) => setA({ ...a, advertDate: e.target.value })} error={msg(t, errors.advertDate)} required />
          <Input label={t("recruitment.lastDate")} type="date" value={a.lastDate} onChange={(e) => setA({ ...a, lastDate: e.target.value })} error={msg(t, errors.lastDate)} required />
        </div>
      </Dialog>
    </>
  );
}

interface Applicant {
  id: string;
  applicationNo: string;
  name: string;
  category: string;
  gender: string;
  dateOfBirth: string;
  mobile: string | null;
  status: string;
  score: number | null;
  meritRank: number | null;
  appointmentLetterNo: string | null;
  joiningId: string | null;
}

function ApplicantRow({ a, canEdit, selectionApproved, canJoin }: { a: Applicant; canEdit: boolean; selectionApproved: boolean; canJoin: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const { busy, run } = useAction();
  const [status, setStatus] = useState(a.status);
  const [score, setScore] = useState(a.score?.toString() ?? "");
  const [rank, setRank] = useState(a.meritRank?.toString() ?? "");
  const dirty = status !== a.status || score !== (a.score?.toString() ?? "") || rank !== (a.meritRank?.toString() ?? "");

  async function save() {
    try {
      await api(`/api/v1/recruitment/applicants/${a.id}`, { method: "PATCH", body: { status, score, meritRank: rank } });
      toast(t("recruitment.saved"));
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
    }
  }

  return (
    <Tr>
      <Td className="tabular text-ink-500" label={t("recruitment.applicationNo")}>{a.applicationNo}</Td>
      <Td className="max-md:order-first">
        <p className="font-medium text-ink-900">{a.name}</p>
        <p className="text-xs text-ink-500">
          {tDynamic(t, `employees.gender.${a.gender}`)} · {formatDate(a.dateOfBirth, locale)}
          {a.mobile ? ` · ${a.mobile}` : ""}
        </p>
      </Td>
      <Td label={t("recruitment.category")}>
        <Badge tone="gray">{a.category}</Badge>
      </Td>
      <Td label={t("recruitment.score")}>
        {canEdit ? (
          <input aria-label={t("recruitment.score")} value={score} onChange={(e) => setScore(e.target.value)} inputMode="decimal" className={controlClass(false, "h-8 w-20 text-right")} />
        ) : (
          <span className="tabular">{a.score ?? "—"}</span>
        )}
      </Td>
      <Td label={t("recruitment.meritRank")}>
        {canEdit ? (
          <input aria-label={t("recruitment.meritRank")} value={rank} onChange={(e) => setRank(e.target.value)} inputMode="numeric" className={controlClass(false, "h-8 w-16 text-right")} />
        ) : (
          <span className="tabular">{a.meritRank ?? "—"}</span>
        )}
      </Td>
      <Td label={t("common.status")}>
        {canEdit ? (
          <select aria-label={t("common.status")} value={status} onChange={(e) => setStatus(e.target.value)} className={controlClass(false, "h-8 w-auto pr-8 text-sm")}>
            {APPLICANT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tDynamic(t, `recruitment.astatus.${s}`)}
              </option>
            ))}
          </select>
        ) : (
          <Badge tone={STATUS_TONE[a.status]} dot>
            {tDynamic(t, `recruitment.astatus.${a.status}`)}
          </Badge>
        )}
      </Td>
      <Td align="right" actions>
        <div className="flex flex-wrap justify-end gap-2">
          {canEdit && dirty && (
            <Button size="sm" variant="subtle" onClick={save}>
              {t("common.save")}
            </Button>
          )}
          {selectionApproved && a.status === "SELECTED" && !a.appointmentLetterNo && (
            <Button size="sm" variant="secondary" icon={<FileText className="size-4" />} loading={busy === "letter"} onClick={() => run("letter", `/api/v1/recruitment/applicants/${a.id}/letter`, {}, t("recruitment.letterIssued"))}>
              {t("recruitment.issueLetter")}
            </Button>
          )}
          {a.appointmentLetterNo && (
            <a href={`/api/v1/recruitment/applicants/${a.id}/letter`} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
              <FileText className="size-4" aria-hidden="true" /> {t("recruitment.printLetter")}
            </a>
          )}
          {a.appointmentLetterNo && canJoin && !a.joiningId && (
            <Button
              size="sm"
              variant="primary"
              icon={<UserPlus className="size-4" />}
              loading={busy === "join"}
              onClick={() => run<{ id: string }>("join", `/api/v1/recruitment/applicants/${a.id}/joining`, {}, t("recruitment.joining.started"), (r) => router.push(`/recruitment/joining/${r.id}`))}
            >
              {t("recruitment.startJoining")}
            </Button>
          )}
          {a.joiningId && (
            <Link href={`/recruitment/joining/${a.joiningId}`} className={buttonClass("subtle", "sm")}>
              {t("recruitment.joiningLink")}
            </Link>
          )}
        </div>
      </Td>
    </Tr>
  );
}

export function ApplicantsPanel({
  vacancyId,
  applicants,
  canEdit,
  canSubmit,
  selectionApproved,
  canJoin,
}: {
  vacancyId: string;
  applicants: Applicant[];
  canEdit: boolean;
  canSubmit: boolean;
  selectionApproved: boolean;
  canJoin: boolean;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const { busy, run } = useAction();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ applicationNo: "", name: "", fatherName: "", gender: "M", dateOfBirth: "", category: "GEN", mobile: "", qualification: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [importErrors, setImportErrors] = useState<{ row: number; errors: string[] }[]>([]);

  async function add() {
    setErrors({});
    try {
      await api(`/api/v1/recruitment/vacancies/${vacancyId}/applicants`, { body: form });
      toast(t("recruitment.saved"));
      setAddOpen(false);
      setForm({ applicationNo: "", name: "", fatherName: "", gender: "M", dateOfBirth: "", category: "GEN", mobile: "", qualification: "" });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        toast(err.message, "error");
      }
    }
  }

  async function importFile(file: File) {
    const data = new FormData();
    data.set("file", file);
    const res = await fetch(`/api/v1/recruitment/vacancies/${vacancyId}/applicants/import`, { method: "POST", body: data });
    const payload = (await res.json()) as { ok: boolean; data?: { imported: number; errors: { row: number; errors: string[] }[] }; error?: { message: string } };
    if (!payload.ok) return toast(payload.error?.message ?? t("errors.generic"), "error");
    setImportErrors(payload.data!.errors);
    if (payload.data!.imported) {
      toast(t("recruitment.imported", { count: payload.data!.imported }));
      router.refresh();
    } else toast(t("recruitment.importErrors"), "error");
  }

  return (
    <Card>
      <CardHeader
        title={t("recruitment.applicants")}
        description={t("recruitment.examNote")}
        actions={
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <>
                <a href="/api/v1/recruitment/applicant-template" download className={buttonClass("ghost", "sm")}>
                  <Download className="size-4" aria-hidden="true" /> {t("recruitment.applicantTemplate")}
                </a>
                <label className={buttonClass("secondary", "sm", "cursor-pointer")}>
                  <Upload className="size-4" aria-hidden="true" /> {t("recruitment.importApplicants")}
                  <input
                    type="file"
                    accept=".xlsx"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void importFile(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAddOpen(true)}>
                  {t("recruitment.addApplicant")}
                </Button>
              </>
            )}
            {canSubmit && (
              <Button size="sm" variant="primary" icon={<Send className="size-4" />} loading={busy === "sel"} onClick={() => run("sel", `/api/v1/recruitment/vacancies/${vacancyId}/selection`, {}, t("recruitment.selectionSent"))}>
                {t("recruitment.submitSelection")}
              </Button>
            )}
          </div>
        }
      />
      {importErrors.length > 0 && (
        <div className="border-b border-ink-100 bg-red-50/60 px-6 py-3 text-sm text-red-800">
          <p className="font-medium">{t("recruitment.importErrors")}</p>
          <ul className="mt-1 list-disc pl-5">
            {importErrors.slice(0, 20).map((r) => (
              <li key={r.row}>
                {t("employees.bulk.row")} {r.row}: {r.errors.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {applicants.length === 0 ? (
        <EmptyState icon={<Users2Icon />} title={t("common.noData")} />
      ) : (
        <Table stack>
          <THead>
            <tr>
              <Th>{t("recruitment.applicationNo")}</Th>
              <Th>{t("common.name")}</Th>
              <Th>{t("recruitment.category")}</Th>
              <Th>{t("recruitment.score")}</Th>
              <Th>{t("recruitment.meritRank")}</Th>
              <Th>{t("common.status")}</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {applicants.map((a) => (
              <ApplicantRow key={a.id} a={a} canEdit={canEdit} selectionApproved={selectionApproved} canJoin={canJoin} />
            ))}
          </tbody>
        </Table>
      )}

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={t("recruitment.addApplicant")}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={add}>
              {t("common.add")}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label={t("recruitment.applicationNo")} value={form.applicationNo} onChange={(e) => setForm({ ...form, applicationNo: e.target.value })} hint={t("recruitment.applicationNoHint")} error={msg(t, errors.applicationNo)} />
          <Input label={t("common.name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={msg(t, errors.name)} required />
          <Input label={t("recruitment.fatherName")} value={form.fatherName} onChange={(e) => setForm({ ...form, fatherName: e.target.value })} />
          <Select label={t("employees.fields.gender")} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            {["M", "F", "T"].map((g) => (
              <option key={g} value={g}>
                {tDynamic(t, `employees.gender.${g}`)}
              </option>
            ))}
          </Select>
          <Input label={t("employees.fields.dateOfBirth")} type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} error={msg(t, errors.dateOfBirth)} required />
          <Select label={t("recruitment.category")} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {RESERVATION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {tDynamic(t, `employees.category.${c}`)}
              </option>
            ))}
          </Select>
          <Input label={t("common.mobile")} value={form.mobile} inputMode="numeric" onChange={(e) => setForm({ ...form, mobile: e.target.value })} error={msg(t, errors.mobile)} />
          <Input label={t("recruitment.qualification")} value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} />
        </div>
      </Dialog>
    </Card>
  );
}

function Users2Icon() {
  return <UserPlus className="size-6" aria-hidden="true" />;
}
