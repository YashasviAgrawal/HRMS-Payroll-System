"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { formatDate } from "@/lib/dates";
import { useI18n } from "@/lib/i18n/client";

const TYPES = ["SUPERANNUATION", "VOLUNTARY", "INVALID", "COMPULSORY", "FAMILY"] as const;

export type CandidatePerson = { id: string; label: string; scheme: "OPS" | "NPS"; status: string; dateOfRetirement: string | null; exitDate: string | null; bankLast4: string | null; family: { id: string; name: string; relation: string; dob: string | null }[] };
export type CaseFormValues = { type: string; lastDay: string; commutationPct: string; nonQualifyingDays: string; familyMemberId: string; mobile: string; fmaEligible: boolean; note: string; bankLast4: string | null };

/** PN-08: the case inputs — the rest comes from the records. Used to start a case and to change a draft. */
export function CaseForm({ people, caseId, initial }: { people: CandidatePerson[]; caseId?: string; initial?: CaseFormValues & { employeeId: string } }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState({
    employeeId: initial?.employeeId ?? (people.length === 1 ? people[0].id : ""),
    type: initial?.type ?? "SUPERANNUATION",
    lastDay: initial?.lastDay ?? "",
    commutationPct: initial?.commutationPct ?? "40",
    nonQualifyingDays: initial?.nonQualifyingDays ?? "",
    familyMemberId: initial?.familyMemberId ?? "",
    mobile: initial?.mobile ?? "",
    bankAccount: "",
    ifsc: "",
    bankName: "",
    fmaEligible: initial?.fmaEligible ?? true,
    note: initial?.note ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const person = people.find((p) => p.id === form.employeeId);
  const nps = person?.scheme === "NPS";
  const death = form.type === "FAMILY";
  const bankLast4 = initial?.bankLast4 ?? person?.bankLast4 ?? null;

  async function send() {
    setBusy(true);
    setErrors({});
    const body = {
      ...form,
      lastDay: form.type === "SUPERANNUATION" && !form.lastDay ? null : form.lastDay || null,
      nonQualifyingDays: form.nonQualifyingDays === "" ? null : form.nonQualifyingDays,
      familyMemberId: form.familyMemberId || null,
      commutationPct: nps || death ? 0 : form.commutationPct,
    };
    try {
      const r = caseId ? await api<{ id: string }>(`/api/v1/pension/cases/${caseId}`, { method: "PATCH", body }) : await api<{ id: string }>("/api/v1/pension/cases", { body });
      toast(t(caseId ? "pension.case.updated" : "pension.case.created"));
      router.push(`/pension/cases/${r.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        toast(err.message, "error");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Select label={t("pension.cases.employee")} value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value, familyMemberId: "" })} error={errors.employeeId} required disabled={Boolean(caseId)} containerClassName="sm:col-span-2">
        <option value="">{t("pension.choose")}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </Select>
      {person && (
        <p className="text-sm text-ink-600 sm:col-span-2">
          {t(nps ? "pension.case.npsNote" : "pension.case.opsNote")} {person.dateOfRetirement && t("pension.case.retiresOn", { date: formatDate(person.dateOfRetirement, locale) })}
        </p>
      )}
      <Select label={t("pension.pensioners.kind")} value={form.type} onChange={set("type")} error={errors.type}>
        {TYPES.map((k) => (
          <option key={k} value={k}>
            {t(`pension.caseTypes.${k}`)}
          </option>
        ))}
      </Select>
      <Input
        label={death ? t("pension.death.date") : t("pension.case.lastDay")}
        hint={form.type === "SUPERANNUATION" ? t("pension.case.lastDayHelp") : undefined}
        type="date"
        value={form.lastDay}
        onChange={set("lastDay")}
        error={errors.lastDay}
        required={form.type !== "SUPERANNUATION"}
      />
      {!nps && !death && <Input label={t("pension.case.commutation")} hint={t("pension.case.commutationHelp")} value={form.commutationPct} onChange={set("commutationPct")} error={errors.commutationPct} inputMode="decimal" />}
      <Input label={t("pension.case.nonQualifying")} hint={t("pension.case.nonQualifyingHelp")} value={form.nonQualifyingDays} onChange={set("nonQualifyingDays")} error={errors.nonQualifyingDays} inputMode="numeric" />
      {death && (
        <Select label={t("pension.death.familyFor")} value={form.familyMemberId} onChange={set("familyMemberId")} error={errors.familyMemberId} required containerClassName="sm:col-span-2">
          <option value="">{t("pension.choose")}</option>
          {person?.family.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.relation})
            </option>
          ))}
        </Select>
      )}
      <Input label={t("pension.fields.mobile")} value={form.mobile} onChange={set("mobile")} error={errors.mobile} inputMode="numeric" maxLength={10} />
      <Input label={death ? t("pension.fields.account") : t("pension.fields.newAccount")} hint={!death && bankLast4 ? t("pension.case.accountKept", { last4: bankLast4 }) : undefined} value={form.bankAccount} onChange={set("bankAccount")} error={errors.bankAccount} inputMode="numeric" autoComplete="off" required={death && !caseId} />
      <Input label={t("pension.fields.ifsc")} value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} error={errors.ifsc} maxLength={11} />
      <Input label={t("pension.fields.bankName")} value={form.bankName} onChange={set("bankName")} error={errors.bankName} />
      {!nps && (
        <div className="sm:col-span-2">
          <Checkbox label={t("pension.fields.fma")} description={t("pension.fields.fmaHelp")} checked={form.fmaEligible} onChange={(e) => setForm({ ...form, fmaEligible: e.target.checked })} />
        </div>
      )}
      <Textarea label={t("pension.case.note")} value={form.note} onChange={set("note")} error={errors.note} maxLength={500} containerClassName="sm:col-span-2" />
      <div className="flex justify-end sm:col-span-2">
        <Button variant="primary" icon={<Calculator className="size-4" />} loading={busy} onClick={send}>
          {caseId ? t("pension.case.workAgain") : t("pension.case.workOut")}
        </Button>
      </div>
    </div>
  );
}
