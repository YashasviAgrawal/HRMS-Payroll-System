"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";

/** PR-01: a new pay commission's matrix, from an Excel sheet, from a date — an Admin approves it. */
export function MatrixUpload({ pending }: { pending: boolean }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (pending) return <p className="text-sm font-medium text-amber-700">{t("rates.pending")}</p>;

  async function send() {
    if (!file) return setErrors({ file: t("validation.required") });
    setBusy(true);
    setErrors({});
    const form = new FormData();
    form.set("file", file);
    form.set("name", name);
    form.set("effectiveFrom", effectiveFrom);
    const res = await fetch("/api/v1/rates/matrix", { method: "POST", body: form });
    const p = (await res.json().catch(() => null)) as { ok: boolean; error?: { message: string; fields?: Record<string, string> } } | null;
    setBusy(false);
    if (!p?.ok) {
      setErrors(p?.error?.fields ?? {});
      return toast(p?.error?.message ?? t("errors.generic"), "error");
    }
    toast(t("rates.sent"));
    setName("");
    setEffectiveFrom("");
    setFile(null);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
      <Input label={t("rates.matrix.name")} placeholder={t("rates.matrix.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} required />
      <Input label={t("rates.effectiveFrom")} type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} error={errors.effectiveFrom} required />
      <Input ref={input} label={t("rates.matrix.file")} type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} error={errors.file} containerClassName="sm:col-span-2" required />
      <div>
        <Button variant="primary" icon={<Upload className="size-4" />} loading={busy} onClick={send}>
          {t("common.submit")}
        </Button>
      </div>
    </div>
  );
}
