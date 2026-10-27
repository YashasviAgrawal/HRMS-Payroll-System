"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BadgeCheck, HeartCrack, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";
import { upload } from "../../statutory/_components/upload";

type Errors = Record<string, string>;
const errorsOf = (err: ApiError): Errors => Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace(/\.\d+$/, ""), v]));

export interface EditablePensioner {
  id: string;
  payee: string;
  payeeHi: string | null;
  mobile: string | null;
  email: string | null;
  ifsc: string | null;
  bankName: string | null;
  bankLast4: string | null;
  fma: boolean;
  basic: number;
  reduced: { amount: number; from: string } | null;
  commuted: number;
  commutationDate: string | null;
}

/** PN-01: change a pensioner's record; a Checker approves. */
export function EditPensionerButton({ p }: { p: EditablePensioner }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const blank = () => ({
    payeeName: p.payee,
    payeeNameHi: p.payeeHi ?? "",
    mobile: p.mobile ?? "",
    email: p.email ?? "",
    bankAccount: "",
    ifsc: p.ifsc ?? "",
    bankName: p.bankName ?? "",
    fmaEligible: p.fma,
    basicPension: String(p.basic),
    reducedPension: p.reduced ? String(p.reduced.amount) : "",
    reducedFrom: p.reduced?.from ?? "",
    commutedAmount: String(p.commuted),
    commutationDate: p.commutationDate ?? "",
    reason: "",
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ReturnType<typeof blank>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  async function send() {
    setBusy(true);
    setErrors({});
    try {
      await api(`/api/v1/pension/pensioners/${p.id}`, {
        method: "PATCH",
        body: {
          ...form,
          reducedPension: form.reducedPension === "" ? null : form.reducedPension,
          reducedFrom: form.reducedFrom || null,
          commutationDate: form.commutationDate || null,
          ifsc: form.bankAccount || form.ifsc !== (p.ifsc ?? "") ? form.ifsc : undefined,
          bankName: form.bankAccount || form.bankName !== (p.bankName ?? "") ? form.bankName : undefined,
        },
      });
      toast(t("pension.edit.sent"));
      setOpen(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(errorsOf(err));
        toast(err.message, "error");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        icon={<PencilLine className="size-4" />}
        onClick={() => {
          setForm(blank());
          setErrors({});
          setOpen(true);
        }}
      >
        {t("pension.edit.button")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closeLabel={t("common.close")}
        size="lg"
        title={t("pension.edit.title")}
        description={t("pension.edit.help")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={send}>
              {t("pension.edit.send")}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label={t("pension.fields.payee")} value={form.payeeName} onChange={set("payeeName")} error={errors.payeeName} required maxLength={120} />
          <Input label={t("pension.fields.payeeHi")} value={form.payeeNameHi} onChange={set("payeeNameHi")} error={errors.payeeNameHi} maxLength={120} lang="hi" />
          <Input label={t("pension.fields.mobile")} value={form.mobile} onChange={set("mobile")} error={errors.mobile} inputMode="numeric" maxLength={10} />
          <Input label={t("pension.fields.email")} type="email" value={form.email} onChange={set("email")} error={errors.email} />
          <Input label={t("pension.fields.newAccount")} hint={p.bankLast4 ? t("pension.fields.accountNow", { last4: p.bankLast4 }) : undefined} value={form.bankAccount} onChange={set("bankAccount")} error={errors.bankAccount} inputMode="numeric" autoComplete="off" />
          <Input label={t("pension.fields.ifsc")} value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} error={errors.ifsc} maxLength={11} />
          <Input label={t("pension.fields.bankName")} value={form.bankName} onChange={set("bankName")} error={errors.bankName} containerClassName="sm:col-span-2" />
          <Input label={t("pension.fields.basic")} value={form.basicPension} onChange={set("basicPension")} error={errors.basicPension} inputMode="decimal" required />
          <div className="self-end">
            <Checkbox label={t("pension.fields.fma")} description={t("pension.fields.fmaHelp")} checked={form.fmaEligible} onChange={(e) => setForm({ ...form, fmaEligible: e.target.checked })} />
          </div>
          <Input label={t("pension.fields.commuted")} value={form.commutedAmount} onChange={set("commutedAmount")} error={errors.commutedAmount} inputMode="decimal" />
          <Input label={t("pension.fields.commutationDate")} type="date" value={form.commutationDate} onChange={set("commutationDate")} error={errors.commutationDate} />
          <Input label={t("pension.fields.reduced")} hint={t("pension.fields.reducedHelp")} value={form.reducedPension} onChange={set("reducedPension")} error={errors.reducedPension} inputMode="decimal" />
          <Input label={t("pension.fields.reducedFrom")} type="date" value={form.reducedFrom} onChange={set("reducedFrom")} error={errors.reducedFrom} />
          <Textarea label={t("pension.edit.reason")} hint={t("pension.edit.reasonHelp")} value={form.reason} onChange={set("reason")} error={errors.reason} required maxLength={300} containerClassName="sm:col-span-2" />
        </div>
      </Dialog>
    </>
  );
}

const RELATIONS = ["SPOUSE", "SON", "DAUGHTER", "MOTHER", "FATHER", "OTHER"] as const;

/** PN-11: record a pensioner's death; a Checker approves. Family pension starts the next day. */
export function DeathButton({ pensionerId, family }: { pensionerId: string; family: { id: string; name: string; relation: string; dob: string | null }[] }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ dateOfDeath: "", note: "", nextPayee: true, familyMemberId: "", payeeName: "", relation: "SPOUSE", payeeDob: "", mobile: "", bankAccount: "", ifsc: "", bankName: "", enhanced: "", normal: "", enhancedUntil: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function suggest(date: string) {
    setForm((f) => ({ ...f, dateOfDeath: date }));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    try {
      const d = await api<{ enhanced: number; normal: number; enhancedUntil: string | null; suggestedMemberId: string | null }>(`/api/v1/pension/pensioners/${pensionerId}/family-pension?date=${date}`);
      setForm((f) => ({ ...f, enhanced: String(d.enhanced), normal: String(d.normal), enhancedUntil: d.enhancedUntil ?? "", familyMemberId: f.familyMemberId || (d.suggestedMemberId ?? "") }));
    } catch {
      /* the figures can be typed in */
    }
  }

  async function send() {
    setBusy(true);
    setErrors({});
    try {
      await api(`/api/v1/pension/pensioners/${pensionerId}/death`, {
        body: {
          ...form,
          familyMemberId: form.familyMemberId || null,
          payeeName: form.familyMemberId ? undefined : form.payeeName,
          relation: form.familyMemberId ? null : form.relation,
          payeeDob: form.familyMemberId ? null : form.payeeDob || null,
          enhanced: form.enhanced === "" ? null : form.enhanced,
          normal: form.normal === "" ? null : form.normal,
          enhancedUntil: form.enhancedUntil || null,
        },
      });
      toast(t("pension.death.sent"));
      setOpen(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(errorsOf(err));
        toast(err.message, "error");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="ghost" icon={<HeartCrack className="size-4" />} onClick={() => setOpen(true)}>
        {t("pension.death.button")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closeLabel={t("common.close")}
        size="lg"
        title={t("pension.death.title")}
        description={t("pension.death.help")}
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
          <Input label={t("pension.death.date")} type="date" value={form.dateOfDeath} onChange={(e) => suggest(e.target.value)} error={errors.dateOfDeath} required />
          <Input label={t("pension.death.note")} hint={t("pension.death.noteHelp")} value={form.note} onChange={set("note")} error={errors.note} required maxLength={300} />
          <div className="sm:col-span-2">
            <Checkbox label={t("pension.death.nextPayee")} description={t("pension.death.nextPayeeHelp")} checked={form.nextPayee} onChange={(e) => setForm({ ...form, nextPayee: e.target.checked })} />
          </div>
          {form.nextPayee && (
            <>
              <Select label={t("pension.death.member")} value={form.familyMemberId} onChange={set("familyMemberId")} error={errors.familyMemberId} containerClassName="sm:col-span-2">
                <option value="">{t("pension.death.notOnRecord")}</option>
                {family.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.relation})
                  </option>
                ))}
              </Select>
              {!form.familyMemberId && (
                <>
                  <Input label={t("pension.fields.payee")} value={form.payeeName} onChange={set("payeeName")} error={errors.payeeName} required />
                  <Select label={t("pension.fields.relation")} value={form.relation} onChange={set("relation")} error={errors.relation}>
                    {RELATIONS.map((r) => (
                      <option key={r} value={r}>
                        {t(`pension.relation.${r}`)}
                      </option>
                    ))}
                  </Select>
                  <Input label={t("pension.fields.dob")} type="date" value={form.payeeDob} onChange={set("payeeDob")} error={errors.payeeDob} required />
                </>
              )}
              <Input label={t("pension.fields.mobile")} value={form.mobile} onChange={set("mobile")} error={errors.mobile} inputMode="numeric" maxLength={10} />
              <Input label={t("pension.fields.account")} value={form.bankAccount} onChange={set("bankAccount")} error={errors.bankAccount} inputMode="numeric" autoComplete="off" required />
              <Input label={t("pension.fields.ifsc")} value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} error={errors.ifsc} maxLength={11} required />
              <Input label={t("pension.fields.bankName")} value={form.bankName} onChange={set("bankName")} error={errors.bankName} />
              <Input label={t("pension.death.enhanced")} hint={t("pension.death.enhancedHelp")} value={form.enhanced} onChange={set("enhanced")} error={errors.enhanced} inputMode="decimal" />
              <Input label={t("pension.death.enhancedUntil")} type="date" value={form.enhancedUntil} onChange={set("enhancedUntil")} error={errors.enhancedUntil} />
              <Input label={t("pension.death.normal")} value={form.normal} onChange={set("normal")} error={errors.normal} inputMode="decimal" />
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}

/** PN-06: the Pension clerk enters a certificate seen at the office (or a Jeevan Pramaan one). */
export function AddCertificateButton({ pensionerId }: { pensionerId: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ source: "MANUAL", certifiedOn: "", jpId: "", note: "" });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setErrors({});
    try {
      const data = new FormData();
      for (const [k, v] of Object.entries(form)) if (v) data.set(k, v);
      if (file) data.set("file", file);
      await upload(`/api/v1/pension/pensioners/${pensionerId}/life-certificates`, data);
      toast(t("pension.lc.saved"));
      setOpen(false);
      setForm({ source: "MANUAL", certifiedOn: "", jpId: "", note: "" });
      setFile(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(errorsOf(err));
        toast(err.message, "error");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="primary" icon={<BadgeCheck className="size-4" />} onClick={() => setOpen(true)}>
        {t("pension.lc.add")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closeLabel={t("common.close")}
        title={t("pension.lc.addTitle")}
        description={t("pension.lc.addHelp")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={send}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Select label={t("pension.lc.source")} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
            <option value="MANUAL">{t("pension.lc.sources.MANUAL")}</option>
            <option value="JEEVAN_PRAMAAN">{t("pension.lc.sources.JEEVAN_PRAMAAN")}</option>
          </Select>
          <Input label={t("pension.lc.date")} type="date" value={form.certifiedOn} onChange={(e) => setForm({ ...form, certifiedOn: e.target.value })} error={errors.certifiedOn} required />
          {form.source === "JEEVAN_PRAMAAN" && <Input label={t("pension.lc.jpId")} value={form.jpId} onChange={(e) => setForm({ ...form, jpId: e.target.value })} error={errors.jpId} required maxLength={40} />}
          <Input label={t("pension.lc.note")} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300} />
          <Input label={t("pension.lc.scan")} hint={t("pension.lc.scanHelp")} type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} error={errors.file} />
        </div>
      </Dialog>
    </>
  );
}
