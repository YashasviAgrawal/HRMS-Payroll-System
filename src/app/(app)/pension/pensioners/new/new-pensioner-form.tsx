"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";

const TYPES = ["SUPERANNUATION", "VOLUNTARY", "INVALID", "COMPULSORY", "FAMILY"] as const;
const RELATIONS = ["SELF", "SPOUSE", "SON", "DAUGHTER", "MOTHER", "FATHER", "OTHER"] as const;

export function NewPensionerForm({ people }: { people: { id: string; label: string; name: string; startDate: string | null }[] }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ employeeId: "", ppoNumber: "", type: "SUPERANNUATION", relation: "SELF", payeeName: "", payeeNameHi: "", payeeDob: "", mobile: "", bankAccount: "", ifsc: "", bankName: "", basicPension: "", commutedAmount: "0", commutationDate: "", reducedPension: "", reducedFrom: "", fmaEligible: true, startDate: "", lastCertificate: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  function pick(id: string) {
    const p = people.find((x) => x.id === id);
    setForm((f) => ({ ...f, employeeId: id, startDate: f.startDate || (p?.startDate ?? ""), payeeName: f.relation === "SELF" && p ? p.name : f.payeeName }));
  }

  async function send() {
    setBusy(true);
    setErrors({});
    try {
      await api("/api/v1/pension/pensioners", { body: { ...form, reducedPension: form.reducedPension === "" ? null : form.reducedPension, reducedFrom: form.reducedFrom || null, commutationDate: form.commutationDate || null, lastCertificate: form.lastCertificate || null } });
      toast(t("pension.newPensioner.sent"));
      router.push("/pension/pensioners");
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
      <Select label={t("pension.newPensioner.employee")} hint={t("pension.newPensioner.employeeHelp")} value={form.employeeId} onChange={(e) => pick(e.target.value)} error={errors.employeeId} required containerClassName="sm:col-span-2">
        <option value="">{t("pension.choose")}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </Select>
      <Input label={t("pension.fields.ppo")} value={form.ppoNumber} onChange={set("ppoNumber")} error={errors.ppoNumber} required maxLength={40} />
      <Select
        label={t("pension.pensioners.kind")}
        value={form.type}
        onChange={(e) => setForm({ ...form, type: e.target.value, relation: e.target.value === "FAMILY" ? (form.relation === "SELF" ? "SPOUSE" : form.relation) : "SELF" })}
        error={errors.type}
      >
        {TYPES.map((k) => (
          <option key={k} value={k}>
            {t(`pension.types.${k}`)}
          </option>
        ))}
      </Select>
      <Select label={t("pension.fields.relation")} value={form.relation} onChange={set("relation")} error={errors.relation} disabled={form.type !== "FAMILY"}>
        {RELATIONS.filter((r) => (form.type === "FAMILY" ? r !== "SELF" : r === "SELF")).map((r) => (
          <option key={r} value={r}>
            {t(`pension.relation.${r}`)}
          </option>
        ))}
      </Select>
      <Input label={t("pension.fields.payee")} value={form.payeeName} onChange={set("payeeName")} error={errors.payeeName} required maxLength={120} />
      <Input label={t("pension.fields.payeeHi")} value={form.payeeNameHi} onChange={set("payeeNameHi")} error={errors.payeeNameHi} maxLength={120} lang="hi" />
      <Input label={t("pension.fields.dob")} type="date" value={form.payeeDob} onChange={set("payeeDob")} error={errors.payeeDob} required />
      <Input label={t("pension.fields.mobile")} value={form.mobile} onChange={set("mobile")} error={errors.mobile} inputMode="numeric" maxLength={10} />
      <Input label={t("pension.fields.account")} value={form.bankAccount} onChange={set("bankAccount")} error={errors.bankAccount} inputMode="numeric" autoComplete="off" required />
      <Input label={t("pension.fields.ifsc")} value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} error={errors.ifsc} maxLength={11} required />
      <Input label={t("pension.fields.bankName")} value={form.bankName} onChange={set("bankName")} error={errors.bankName} />
      <Input label={t("pension.fields.basic")} value={form.basicPension} onChange={set("basicPension")} error={errors.basicPension} inputMode="decimal" required />
      <Input label={t("pension.fields.commuted")} value={form.commutedAmount} onChange={set("commutedAmount")} error={errors.commutedAmount} inputMode="decimal" />
      <Input label={t("pension.fields.commutationDate")} type="date" value={form.commutationDate} onChange={set("commutationDate")} error={errors.commutationDate} />
      <Input label={t("pension.fields.reduced")} hint={t("pension.fields.reducedHelp")} value={form.reducedPension} onChange={set("reducedPension")} error={errors.reducedPension} inputMode="decimal" />
      <Input label={t("pension.fields.reducedFrom")} type="date" value={form.reducedFrom} onChange={set("reducedFrom")} error={errors.reducedFrom} />
      <Input label={t("pension.fields.startDate")} type="date" value={form.startDate} onChange={set("startDate")} error={errors.startDate} required />
      <Input label={t("pension.newPensioner.lastCertificate")} hint={t("pension.newPensioner.lastCertificateHelp")} type="date" value={form.lastCertificate} onChange={set("lastCertificate")} error={errors.lastCertificate} />
      <div className="sm:col-span-2">
        <Checkbox label={t("pension.fields.fma")} description={t("pension.fields.fmaHelp")} checked={form.fmaEligible} onChange={(e) => setForm({ ...form, fmaEligible: e.target.checked })} />
      </div>
      <div className="sm:col-span-2 flex justify-end">
        <Button variant="primary" icon={<Send className="size-4" />} loading={busy} onClick={send}>
          {t("pension.newPensioner.send")}
        </Button>
      </div>
    </div>
  );
}
