"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { HeartCrack } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";

type Person = { id: string; label: string; family: { id: string; name: string; relation: string }[] };

/** PN-11: a death in service — a Checker approves; pay stops and a family pension case is started. */
export function EmployeeDeathButton({ people }: { people: Person[] }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employeeId: "", dateOfDeath: "", note: "", familyMemberId: "", mobile: "", bankAccount: "", ifsc: "", bankName: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const person = people.find((p) => p.id === form.employeeId);

  async function send() {
    setBusy(true);
    setErrors({});
    try {
      await api("/api/v1/pension/deaths", { body: { ...form, nextPayee: true, familyMemberId: form.familyMemberId || null } });
      toast(t("pension.death.sent"));
      setOpen(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace(/\.\d+$/, ""), v])));
        toast(err.message, "error");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" icon={<HeartCrack className="size-4" />} onClick={() => setOpen(true)}>
        {t("pension.death.inService")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closeLabel={t("common.close")}
        size="lg"
        title={t("pension.death.inServiceTitle")}
        description={t("pension.death.inServiceHelp")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={busy} onClick={send}>
              {t("pension.death.send")}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label={t("pension.cases.employee")} value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value, familyMemberId: "" })} error={errors.employeeId} required containerClassName="sm:col-span-2">
            <option value="">{t("pension.choose")}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          <Input label={t("pension.death.date")} type="date" value={form.dateOfDeath} onChange={set("dateOfDeath")} error={errors.dateOfDeath} required />
          <Input label={t("pension.death.note")} hint={t("pension.death.noteHelp")} value={form.note} onChange={set("note")} error={errors.note} required maxLength={300} />
          <Select label={t("pension.death.familyFor")} value={form.familyMemberId} onChange={set("familyMemberId")} error={errors.familyMemberId} required containerClassName="sm:col-span-2" disabled={!person}>
            <option value="">{t("pension.choose")}</option>
            {person?.family.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.relation})
              </option>
            ))}
          </Select>
          <Input label={t("pension.fields.mobile")} value={form.mobile} onChange={set("mobile")} error={errors.mobile} inputMode="numeric" maxLength={10} />
          <Input label={t("pension.fields.account")} value={form.bankAccount} onChange={set("bankAccount")} error={errors.bankAccount} inputMode="numeric" autoComplete="off" required />
          <Input label={t("pension.fields.ifsc")} value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} error={errors.ifsc} maxLength={11} required />
          <Input label={t("pension.fields.bankName")} value={form.bankName} onChange={set("bankName")} error={errors.bankName} />
        </div>
      </Dialog>
    </>
  );
}
