"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Eye, EyeOff, FileUp, Plus, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n, useT } from "@/lib/i18n/client";
import { EVENTS_NEEDING_APPROVER, SERVICE_EVENTS } from "@/modules/employees/schema";
import { docTypeName, type DocumentType } from "@/modules/settings/schema";
import { msg } from "./fields";

/** Shows a masked number; HR and Checkers may reveal it (each look is audited). */
export function RevealValue({ masked, url, field }: { masked: string | null; url: string; field: "pan" | "bankAccount" }) {
  const t = useT();
  const toast = useToast();
  const [value, setValue] = useState<string | null>(null);
  if (!masked) return <span className="text-ink-400">{t("employees.profile.noValue")}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="tabular font-medium tracking-wide">{value ?? masked}</span>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
        onClick={async () => {
          if (value) return setValue(null);
          try {
            setValue((await api<{ value: string }>(url, { body: { field } })).value);
          } catch (err) {
            toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
          }
        }}
      >
        {value ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
        {value ? t("employees.profile.hide") : t("employees.profile.showFull")}
      </button>
    </span>
  );
}

export function WithdrawButton({ taskId }: { taskId: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      icon={<Undo2 className="size-4" />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/api/v1/approvals/${taskId}/cancel`, { body: {} });
          toast(t("employees.profile.withdrawn"));
          router.refresh();
        } catch (err) {
          toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {t("employees.profile.withdraw")}
    </Button>
  );
}

/** Upload one document; returns its id to the caller (used alone and inside other forms). */
export async function uploadDoc(employeeId: string, file: File, category: string, title: string) {
  const form = new FormData();
  form.set("file", file);
  form.set("category", category);
  form.set("title", title);
  const res = await fetch(`/api/v1/employees/${employeeId}/documents`, { method: "POST", body: form, credentials: "same-origin" });
  const payload = (await res.json()) as { ok: boolean; data?: { id: string }; error?: { message: string; fields?: Record<string, string> } };
  if (!payload.ok) throw new ApiError(payload.error?.message ?? "Upload failed", res.status, "upload", payload.error?.fields);
  return payload.data!.id;
}

export function DocumentUpload({ employeeId, types, defaultType, label }: { employeeId: string; types: DocumentType[]; defaultType?: string; label?: string }) {
  const t = useT();
  const { locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(defaultType ?? types[0]?.code ?? "OTHER");
  const type = types.find((x) => x.code === category);
  const maxMb = type?.maxMb ?? 5;
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" icon={<FileUp className="size-4" />} onClick={() => setOpen(true)}>
        {label ?? t("employees.documents.upload")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={label ?? t("employees.documents.upload")}
        description={t("employees.documents.fileHintMb", { mb: maxMb })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!file}
              onClick={async () => {
                if (!file) return;
                if (file.size > maxMb * 1024 * 1024) return setError(t("employees.errors.fileTooBig", { mb: maxMb }));
                setBusy(true);
                setError(undefined);
                try {
                  await uploadDoc(employeeId, file, category, title);
                  toast(t("employees.documents.uploaded"));
                  setOpen(false);
                  setFile(null);
                  setTitle("");
                  router.refresh();
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : t("errors.generic"));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("common.upload")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select label={t("employees.documents.category")} value={category} onChange={(e) => setCategory(e.target.value)}>
            {types.map((c) => (
              <option key={c.code} value={c.code}>
                {docTypeName(types, c.code, locale)} ({t("employees.documents.upToMb", { mb: c.maxMb })})
              </option>
            ))}
          </Select>
          <Input label={t("employees.documents.titleLabel")} value={title} onChange={(e) => setTitle(e.target.value)} optionalLabel={t("common.optional")} />
          <Input label={t("employees.documents.file")} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} error={error} className="py-1.5" />
        </div>
      </Dialog>
    </>
  );
}

export function DocumentDelete({ documentId }: { documentId: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"
      aria-label={t("employees.documents.delete")}
      title={t("employees.documents.delete")}
      onClick={async () => {
        if (!window.confirm(t("employees.documents.confirmDelete"))) return;
        try {
          await api(`/api/v1/documents/${documentId}`, { method: "DELETE" });
          toast(t("employees.documents.deleted"));
          router.refresh();
        } catch (err) {
          toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
        }
      }}
    >
      <Trash2 className="size-4" />
    </button>
  );
}

export function ServiceEntryDialog({ employeeId }: { employeeId: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ event: "INCREMENT", eventDate: "", orderNumber: "", orderDate: "", details: "", detailsHi: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: x }));
  const needsApprover = (EVENTS_NEEDING_APPROVER as readonly string[]).includes(v.event);

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      let documentId: string | null = null;
      const file = fileRef.current?.files?.[0];
      if (file) documentId = await uploadDoc(employeeId, file, "SERVICE_ORDER", `${v.event} order ${v.orderNumber}`.trim());
      await api(`/api/v1/employees/${employeeId}/service-book`, { body: { ...v, documentId } });
      toast(t("employees.serviceBook.sent"));
      setOpen(false);
      setV({ event: "INCREMENT", eventDate: "", orderNumber: "", orderDate: "", details: "", detailsHi: "" });
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
    <>
      <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
        {t("employees.serviceBook.add")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("employees.serviceBook.add")}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={save}>
              {t("employees.edit.submit")}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label={t("common.type")} value={v.event} onChange={(e) => set("event", e.target.value)}>
            {SERVICE_EVENTS.map((ev) => (
              <option key={ev} value={ev}>
                {tDynamic(t, `employees.event.${ev}`)}
              </option>
            ))}
          </Select>
          <Input label={t("employees.serviceBook.eventDate")} type="date" value={v.eventDate} onChange={(e) => set("eventDate", e.target.value)} error={msg(t, errors.eventDate)} required />
          <Input label={t("employees.serviceBook.orderNo")} value={v.orderNumber} onChange={(e) => set("orderNumber", e.target.value)} optionalLabel={t("common.optional")} />
          <Input label={t("employees.serviceBook.orderDate")} type="date" value={v.orderDate} onChange={(e) => set("orderDate", e.target.value)} error={msg(t, errors.orderDate)} optionalLabel={t("common.optional")} />
          <Textarea label={t("employees.serviceBook.details")} value={v.details} onChange={(e) => set("details", e.target.value)} error={msg(t, errors.details)} required containerClassName="sm:col-span-2" />
          <Textarea label={t("employees.serviceBook.detailsHi")} value={v.detailsHi} lang="hi" onChange={(e) => set("detailsHi", e.target.value)} optionalLabel={t("common.optional")} containerClassName="sm:col-span-2" />
          <Input ref={fileRef} label={t("employees.serviceBook.attachOrder")} type="file" accept="application/pdf,image/jpeg,image/png" hint={t("employees.documents.fileHint")} optionalLabel={t("common.optional")} className="py-1.5" containerClassName="sm:col-span-2" />
          {needsApprover && <p className="rounded-lg bg-gold-50 px-3 py-2 text-sm text-gold-600 sm:col-span-2">{t("employees.serviceBook.needsApprover")}</p>}
        </div>
      </Dialog>
    </>
  );
}
