"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Building2, Home, Send, Smartphone, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { AddressFields, msg } from "../../employees/_components/fields";
import { uploadDoc } from "../../employees/_components/widgets";

type Kind = "address" | "mobile" | "bank" | "nominee";

export function NewRequest({ employeeId, startOpen }: { employeeId: string; startOpen: boolean }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [kind, setKind] = useState<Kind | null>(startOpen ? "address" : null);
  const [present, setPresent] = useState<Record<string, string> | null>(null);
  const [permanent, setPermanent] = useState<Record<string, string> | null>(null);
  const [mobile, setMobile] = useState("");
  const [bank, setBank] = useState({ bankAccount: "", ifsc: "", bankName: "", bankBranch: "" });
  const [details, setDetails] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const kinds: { key: Kind; icon: typeof Home }[] = [
    { key: "address", icon: Home },
    { key: "mobile", icon: Smartphone },
    { key: "bank", icon: Building2 },
    { key: "nominee", icon: Users },
  ];

  async function submit() {
    if (!kind) return;
    setBusy(true);
    setErrors({});
    try {
      let body: Record<string, unknown> = { kind, note };
      if (kind === "address") body = { ...body, presentAddress: present, permanentAddress: permanent ?? present };
      if (kind === "mobile") body = { ...body, mobile };
      if (kind === "nominee") body = { ...body, details };
      if (kind === "bank") {
        const file = fileRef.current?.files?.[0];
        const documentId = file ? await uploadDoc(employeeId, file, "OTHER", "Bank account proof") : null;
        body = { ...body, ...bank, documentId };
      }
      await api("/api/v1/me/requests", { body });
      toast(t("my.sent"));
      setKind(null);
      router.replace("/my/requests");
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
    <Card>
      <CardHeader title={t("my.newRequest")} />
      <CardBody className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {kinds.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setKind(k.key)}
              aria-pressed={kind === k.key}
              className={cn(
                "flex flex-col items-center gap-2 rounded-xl border p-4 text-center text-sm font-medium transition-colors",
                kind === k.key ? "border-brand-500 bg-brand-50 text-brand-800" : "border-ink-200 text-ink-700 hover:border-ink-300 hover:bg-ink-50",
              )}
            >
              <k.icon className="size-5" aria-hidden="true" />
              {t(`my.kind.${k.key}`)}
            </button>
          ))}
        </div>
        {kind === "address" && (
          <div className="space-y-4">
            <AddressFields label={t("employees.fields.presentAddress")} value={present} onChange={setPresent} errors={errors} errorPrefix="presentAddress" />
            <AddressFields label={t("employees.fields.permanentAddress")} value={permanent} onChange={setPermanent} errors={errors} errorPrefix="permanentAddress" />
          </div>
        )}
        {kind === "mobile" && <Input label={t("profile.newMobile")} value={mobile} inputMode="numeric" onChange={(e) => setMobile(e.target.value)} error={msg(t, errors.mobile)} containerClassName="sm:max-w-sm" />}
        {kind === "bank" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t("employees.fields.bankAccount")} value={bank.bankAccount} inputMode="numeric" onChange={(e) => setBank({ ...bank, bankAccount: e.target.value })} error={msg(t, errors.bankAccount)} required />
            <Input label={t("employees.fields.ifsc")} value={bank.ifsc} onChange={(e) => setBank({ ...bank, ifsc: e.target.value.toUpperCase() })} error={msg(t, errors.ifsc)} required />
            <Input label={t("employees.fields.bankName")} value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} />
            <Input label={t("employees.fields.bankBranch")} value={bank.bankBranch} onChange={(e) => setBank({ ...bank, bankBranch: e.target.value })} />
            <Input ref={fileRef} label={t("my.bankProof")} type="file" accept="application/pdf,image/jpeg,image/png" hint={t("employees.documents.fileHint")} className="py-1.5" containerClassName="sm:col-span-2" />
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800 sm:col-span-2">{t("my.bankNote")}</p>
          </div>
        )}
        {kind === "nominee" && <Textarea label={t("my.nomineeDetails")} value={details} onChange={(e) => setDetails(e.target.value)} error={msg(t, errors.details)} rows={4} />}
        {kind && <Textarea label={t("common.note")} value={note} onChange={(e) => setNote(e.target.value)} optionalLabel={t("common.optional")} rows={2} />}
      </CardBody>
      {kind && (
        <CardFooter>
          <Button variant="primary" loading={busy} onClick={submit} icon={<Send className="size-4" />}>
            {t("common.submit")}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
