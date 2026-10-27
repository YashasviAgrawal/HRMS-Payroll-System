"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { MatrixLevels } from "@/modules/payroll/matrix-7cpc";
import { familySchema, GENDERS, idsSchema, jobSchema, NOMINEE_SCHEMES, personalSchema, RELATIONS } from "@/modules/employees/schema";
import type { EmployeeView } from "@/modules/employees/service";
import { IdsFields, issuesToErrors, JobFields, msg, PersonalFields, type Errors, type Option, type PostOption, type Values } from "../../_components/fields";

export type EditTabKey = "personal" | "job" | "ids" | "family";

interface Member {
  id?: string;
  name: string;
  nameHi: string;
  relation: string;
  gender: string;
  dateOfBirth: string;
  isDependent: boolean;
  isDisabled: boolean;
  isAlive: boolean;
}
interface Nom {
  scheme: string;
  memberIndex: number;
  sharePercent: number;
}

function initial(tab: EditTabKey, e: EmployeeView): Values {
  if (tab === "personal") {
    const same = JSON.stringify(e.presentAddress) === JSON.stringify(e.permanentAddress) && e.presentAddress !== null;
    return {
      firstName: e.firstName, middleName: e.middleName, lastName: e.lastName, nameHi: e.nameHi, gender: e.gender, dateOfBirth: e.dateOfBirth,
      fatherOrSpouseName: e.fatherOrSpouseName, category: e.category, maritalStatus: e.maritalStatus, bloodGroup: e.bloodGroup, isDisabled: e.isDisabled,
      mobile: e.mobile, email: e.email, presentAddress: e.presentAddress, permanentAddress: e.permanentAddress, __sameAddress: same,
    };
  }
  if (tab === "job") {
    return {
      type: e.type, sectionId: e.section.id, postId: e.post.id, dateOfJoining: e.dateOfJoining, payLevel: e.payLevel, payCell: e.payCell,
      probationEndDate: e.probationEndDate, confirmationDate: e.confirmationDate, agencyName: e.agencyName, wageRate: e.wageRate,
      wageBasis: e.wageBasis, contractStart: e.contractStart, contractEnd: e.contractEnd, biometricId: e.biometricId,
    };
  }
  return {
    pran: e.ids?.pran, uan: e.ids?.uan, esicNumber: e.ids?.esicNumber, gpfNumber: e.ids?.gpfNumber, ifsc: e.ids?.ifsc, bankName: e.ids?.bankName, bankBranch: e.ids?.bankBranch,
  };
}

export function EditEmployeeForm({
  tab,
  employee,
  family,
  sections,
  posts,
  payMatrix,
}: {
  tab: EditTabKey;
  employee: EmployeeView;
  family: { members: Member[]; nominees: Nom[] };
  sections: Option[];
  posts: PostOption[];
  payMatrix: MatrixLevels;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [values, setValues] = useState<Values>(() => initial(tab, employee));
  const [members, setMembers] = useState<Member[]>(family.members);
  const [nominees, setNominees] = useState<Nom[]>(family.nominees);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const draft = employee.status === "DRAFT";

  async function submit() {
    setErrors({});
    let body: unknown;
    let url = `/api/v1/employees/${employee.id}/edit`;
    if (tab === "family") {
      const data = { members, nominees, note };
      const r = familySchema.safeParse(data);
      if (!r.success) return setErrors(issuesToErrors(r.error.issues));
      body = data;
      url = `/api/v1/employees/${employee.id}/family`;
    } else {
      const schema = tab === "personal" ? personalSchema : tab === "job" ? jobSchema : idsSchema;
      const r = schema.safeParse(values);
      if (!r.success) return setErrors(issuesToErrors(r.error.issues));
      body = { ...values, tab, note };
    }
    setBusy(true);
    try {
      const res = await api<{ applied: boolean }>(url, { body });
      toast(res.applied ? t("employees.edit.saved") : t("employees.edit.sent"));
      router.push(`/employees/${employee.id}?tab=${tab}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        toast(err.message, "error");
      }
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={t(`employees.tabs.${tab}`)} description={employee.employeeCode ? `${employee.name} · ${employee.employeeCode}` : employee.name} />
      <CardBody className="space-y-6">
        {tab === "personal" && <PersonalFields values={values} onChange={setValues} errors={errors} />}
        {tab === "job" && <JobFields values={values} onChange={setValues} errors={errors} sections={sections} posts={posts} payMatrix={payMatrix} />}
        {tab === "ids" && <IdsFields values={values} onChange={setValues} errors={errors} current={employee.ids ? { pan: employee.ids.pan, aadhaar: employee.ids.aadhaar, bankAccount: employee.ids.bankAccount } : undefined} />}
        {tab === "family" && <FamilyEditor members={members} setMembers={setMembers} nominees={nominees} setNominees={setNominees} errors={errors} />}
        {!draft && (
          <Textarea label={t("employees.edit.noteLabel")} placeholder={t("employees.edit.notePlaceholder")} value={note} onChange={(e) => setNote(e.target.value)} optionalLabel={t("common.optional")} />
        )}
      </CardBody>
      <CardFooter>
        <Button variant="ghost" onClick={() => router.back()}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" onClick={submit} loading={busy} icon={<Send className="size-4" />}>
          {draft ? t("employees.edit.saveDraft") : t("employees.edit.submit")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function FamilyEditor({
  members,
  setMembers,
  nominees,
  setNominees,
  errors,
}: {
  members: Member[];
  setMembers: (m: Member[]) => void;
  nominees: Nom[];
  setNominees: (n: Nom[]) => void;
  errors: Errors;
}) {
  const { t } = useI18n();
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nominees) m.set(n.scheme, (m.get(n.scheme) ?? 0) + (Number(n.sharePercent) || 0));
    return m;
  }, [nominees]);
  const updateMember = (i: number, patch: Partial<Member>) => setMembers(members.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const removeMember = (i: number) => {
    setMembers(members.filter((_, j) => j !== i));
    setNominees(nominees.filter((n) => n.memberIndex !== i).map((n) => ({ ...n, memberIndex: n.memberIndex > i ? n.memberIndex - 1 : n.memberIndex })));
  };
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink-900">{t("employees.family.members")}</h3>
        {members.length === 0 && <p className="text-sm text-ink-500">{t("employees.family.empty")}</p>}
        {members.map((m, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-ink-200 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
              <Input label={t("common.name")} value={m.name} onChange={(e) => updateMember(i, { name: e.target.value })} error={msg(t, errors[`members.${i}.name`])} required />
              <Select label={t("employees.family.relation")} value={m.relation} onChange={(e) => updateMember(i, { relation: e.target.value })}>
                {RELATIONS.map((r) => (
                  <option key={r} value={r}>
                    {tDynamic(t, `employees.relation.${r}`)}
                  </option>
                ))}
              </Select>
              <Select label={t("employees.fields.gender")} value={m.gender} onChange={(e) => updateMember(i, { gender: e.target.value })}>
                <option value="">—</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {tDynamic(t, `employees.gender.${g}`)}
                  </option>
                ))}
              </Select>
              <Input label={t("employees.fields.dateOfBirth")} type="date" value={m.dateOfBirth} onChange={(e) => updateMember(i, { dateOfBirth: e.target.value })} />
              <div className="flex items-end">
                <button type="button" onClick={() => removeMember(i)} className="mb-1 rounded-lg p-2 text-ink-400 hover:bg-red-50 hover:text-red-600" aria-label={t("common.remove")}>
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Checkbox label={t("employees.family.dependent")} checked={m.isDependent} onChange={(e) => updateMember(i, { isDependent: e.target.checked })} className="py-2" />
              <Checkbox label={t("employees.fields.isDisabled")} checked={m.isDisabled} onChange={(e) => updateMember(i, { isDisabled: e.target.checked })} className="py-2" />
              <Checkbox label={t("employees.family.deceased")} checked={!m.isAlive} onChange={(e) => updateMember(i, { isAlive: !e.target.checked })} className="py-2" />
            </div>
          </div>
        ))}
        <Button
          variant="subtle"
          size="sm"
          icon={<Plus className="size-4" />}
          onClick={() => setMembers([...members, { name: "", nameHi: "", relation: "SPOUSE", gender: "", dateOfBirth: "", isDependent: false, isDisabled: false, isAlive: true }])}
        >
          {t("employees.family.addMember")}
        </Button>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">{t("employees.family.nominees")}</h3>
          <p className="text-xs text-ink-500">{t("employees.family.nomineesHint")}</p>
        </div>
        {nominees.map((n, i) => (
          <div key={i} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1.4fr_8rem_auto]">
            <Select label={t("common.type")} value={n.scheme} onChange={(e) => setNominees(nominees.map((x, j) => (j === i ? { ...x, scheme: e.target.value } : x)))}>
              {NOMINEE_SCHEMES.map((s) => (
                <option key={s} value={s}>
                  {tDynamic(t, `employees.scheme.${s}`)}
                </option>
              ))}
            </Select>
            <Select label={t("employees.family.member")} value={String(n.memberIndex)} onChange={(e) => setNominees(nominees.map((x, j) => (j === i ? { ...x, memberIndex: Number(e.target.value) } : x)))}>
              {members.map((m, mi) => (
                <option key={mi} value={mi}>
                  {m.name || `#${mi + 1}`} ({tDynamic(t, `employees.relation.${m.relation}`)})
                </option>
              ))}
            </Select>
            <Input label={t("employees.family.share")} type="number" min={1} max={100} value={n.sharePercent} onChange={(e) => setNominees(nominees.map((x, j) => (j === i ? { ...x, sharePercent: Number(e.target.value) } : x)))} />
            <button type="button" onClick={() => setNominees(nominees.filter((_, j) => j !== i))} className="mb-1 rounded-lg p-2 text-ink-400 hover:bg-red-50 hover:text-red-600" aria-label={t("common.remove")}>
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        {totals.size > 0 && (
          <div className="flex flex-wrap gap-2">
            {[...totals.entries()].map(([scheme, total]) => (
              <span key={scheme} className={cn("rounded-full px-2.5 py-1 text-xs font-medium", Math.abs(total - 100) < 0.01 ? "bg-brand-50 text-brand-800" : "bg-red-50 text-red-700")}>
                {tDynamic(t, `employees.scheme.${scheme}`)}: {t("employees.family.total", { total })}
              </span>
            ))}
          </div>
        )}
        {Object.keys(errors).some((k) => k.startsWith("nominees")) && <p className="text-sm font-medium text-red-600">{t("employees.errors.sharesNot100")}</p>}
        <Button
          variant="subtle"
          size="sm"
          icon={<Plus className="size-4" />}
          disabled={members.length === 0}
          onClick={() => setNominees([...nominees, { scheme: "GPF", memberIndex: 0, sharePercent: 100 }])}
        >
          {t("employees.family.addNominee")}
        </Button>
      </section>
    </div>
  );
}
