"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/http";
import { useT } from "@/lib/i18n/client";
import { upload } from "../../statutory/_components/upload";

/** PN-06: upload the Jeevan Pramaan certificate (PDF or photo); the Pension clerk checks it. */
export function UploadCertificate() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ jpId: "", certifiedOn: "" });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setErrors({});
    try {
      const data = new FormData();
      data.set("jpId", form.jpId);
      data.set("certifiedOn", form.certifiedOn);
      if (file) data.set("file", file);
      await upload("/api/v1/me/life-certificate", data);
      toast(t("pension.my.uploaded"));
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Input label={t("pension.lc.jpId")} hint={t("pension.my.jpIdHelp")} value={form.jpId} onChange={(e) => setForm({ ...form, jpId: e.target.value })} error={errors.jpId} required maxLength={40} />
      <Input label={t("pension.lc.date")} type="date" value={form.certifiedOn} onChange={(e) => setForm({ ...form, certifiedOn: e.target.value })} error={errors.certifiedOn} required />
      <Input label={t("pension.my.file")} hint={t("pension.lc.scanHelp")} type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} error={errors.file} required containerClassName="sm:col-span-2" />
      <div className="sm:col-span-2">
        <Button variant="primary" icon={<Upload className="size-4" />} loading={busy} onClick={send}>
          {t("pension.my.send")}
        </Button>
      </div>
    </div>
  );
}
