"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CalendarCheck2, Send, TriangleAlert, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter } from "@/components/ui/card";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/dates";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

interface TypeOption {
  code: string;
  name: string;
  available: number | null;
  creditMode: string;
}

interface Preview {
  days: number;
  debitCode: string;
  debitDays: number;
  balance: number | null;
  after: number | null;
  decider: "REPORTING_OFFICER" | "APPROVER" | "CHECKER";
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** LV-03: apply with the live balance — days, balance after and who decides update as you type. */
export function ApplyForm({
  types,
  rules,
  restrictedHolidays,
  initial,
  minDate,
  maxDate,
  employeeId,
  onBehalf,
}: {
  types: TypeOption[];
  rules: Record<string, { halfDayAllowed: boolean; needsCertificate: boolean; restrictedOnly: boolean }>;
  restrictedHolidays: { date: string; name: string }[];
  initial: { leaveCode: string; fromDate: string; toDate: string };
  minDate?: string;
  maxDate?: string;
  /** HR entering leave for someone (LV-05). */
  employeeId?: string;
  onBehalf?: boolean;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [v, setV] = useState({ ...initial, halfDay: false, reason: "", contact: "", sanctionRef: "" });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const rule = rules[v.leaveCode];
  const canHalf = !!rule?.halfDayAllowed && v.fromDate === v.toDate;

  useEffect(() => {
    if (!v.leaveCode || !v.fromDate || !v.toDate || (onBehalf && !employeeId)) return;
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const p = await api<Preview>("/api/v1/leave/preview", { body: { leaveCode: v.leaveCode, fromDate: v.fromDate, toDate: v.toDate, halfDay: canHalf && v.halfDay, ...(onBehalf ? { employeeId } : {}) } });
        if (id !== seq.current) return;
        setPreview(p);
        setPreviewError(null);
      } catch (err) {
        if (id !== seq.current) return;
        setPreview(null);
        setPreviewError(err instanceof ApiError ? err.message : t("errors.generic"));
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [v.leaveCode, v.fromDate, v.toDate, v.halfDay, canHalf, employeeId, onBehalf, t]);

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      if (onBehalf) {
        const r = await api<{ id: string }>("/api/v1/leave/entries", { body: { employeeId, leaveCode: v.leaveCode, fromDate: v.fromDate, toDate: v.toDate, halfDay: canHalf && v.halfDay, reason: v.reason, contact: v.contact || undefined, sanctionRef: v.sanctionRef } });
        toast(t("leave.enter.sent"));
        router.push(`/leave/applications/${r.id}`);
        return;
      }
      const form = new FormData();
      form.set("leaveCode", v.leaveCode);
      form.set("fromDate", v.fromDate);
      form.set("toDate", v.toDate);
      form.set("halfDay", String(canHalf && v.halfDay));
      form.set("reason", v.reason);
      if (v.contact) form.set("contact", v.contact);
      if (file) form.set("file", file);
      const res = await fetch("/api/v1/leave/applications", { method: "POST", body: form });
      const payload = (await res.json()) as { ok: boolean; data?: { id: string }; error?: { message: string; fields?: Record<string, string> } };
      if (!payload.ok) {
        setErrors(payload.error?.fields ?? {});
        toast(payload.error?.message ?? t("errors.generic"), "error");
        return;
      }
      toast(t("leave.sent"));
      router.push(`/leave/applications/${payload.data!.id}`);
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
      <CardBody className="grid gap-5 sm:grid-cols-2">
        <Select
          label={t("leave.type")}
          value={v.leaveCode}
          onChange={(e) => {
            const code = e.target.value;
            const rh = rules[code]?.restrictedOnly ? restrictedHolidays[0]?.date : undefined;
            setV({ ...v, leaveCode: code, halfDay: false, ...(rh ? { fromDate: rh, toDate: rh } : {}) });
          }}
          error={errors.leaveCode}
          containerClassName="sm:col-span-2"
          required
        >
          {types.map((o) => (
            <option key={o.code} value={o.code}>
              {o.name} ({o.code}){o.available !== null && (o.creditMode === "HALF_YEARLY" || o.creditMode === "YEARLY") ? ` — ${fmt(o.available)}` : ""}
            </option>
          ))}
        </Select>
        {rule?.restrictedOnly ? (
          <Select label={t("leave.fromDate")} value={v.fromDate} onChange={(e) => setV({ ...v, fromDate: e.target.value, toDate: e.target.value })} hint={t("leave.rhHint")} containerClassName="sm:col-span-2" required>
            {restrictedHolidays.map((h) => (
              <option key={h.date} value={h.date}>
                {formatDate(h.date, locale)} — {h.name}
              </option>
            ))}
          </Select>
        ) : (
          <>
            <Input label={t("leave.fromDate")} type="date" value={v.fromDate} min={minDate} max={maxDate} onChange={(e) => setV({ ...v, fromDate: e.target.value, toDate: v.toDate < e.target.value ? e.target.value : v.toDate })} error={errors.fromDate} required />
            <Input label={t("leave.toDate")} type="date" value={v.toDate} min={v.fromDate} max={maxDate} onChange={(e) => setV({ ...v, toDate: e.target.value })} error={errors.toDate} required />
          </>
        )}
        {canHalf && <Checkbox label={t("leave.halfDay")} checked={v.halfDay} onChange={(e) => setV({ ...v, halfDay: e.target.checked })} />}

        <div className="rounded-xl bg-ink-50 p-4 sm:col-span-2" aria-live="polite">
          {preview ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="flex items-center gap-2 font-semibold text-brand-900">
                <CalendarCheck2 className="size-4" aria-hidden="true" /> {t("leave.preview.days", { days: fmt(preview.days) })}
              </span>
              {preview.debitCode !== v.leaveCode && <span className="text-ink-700">{t("leave.preview.uses", { days: fmt(preview.debitDays), code: preview.debitCode })}</span>}
              {preview.after !== null && <span className="text-ink-700">{t("leave.preview.after", { code: preview.debitCode, after: fmt(preview.after) })}</span>}
              <span className="flex items-center gap-1.5 text-ink-600">
                <UserCheck className="size-4" aria-hidden="true" /> {tDynamic(t, `leave.preview.decider.${preview.decider}`)}
              </span>
            </div>
          ) : previewError ? (
            <p className="flex items-center gap-2 text-sm font-medium text-red-700">
              <TriangleAlert className="size-4" aria-hidden="true" /> {previewError}
            </p>
          ) : (
            <p className="text-sm text-ink-500">…</p>
          )}
        </div>

        <Textarea label={t("leave.reason")} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder={t("leave.reasonPlaceholder")} error={errors.reason} required rows={3} containerClassName="sm:col-span-2" />
        <Input label={t("leave.contact")} value={v.contact} onChange={(e) => setV({ ...v, contact: e.target.value })} placeholder={t("leave.contactPlaceholder")} optionalLabel={t("common.optional")} containerClassName="sm:col-span-2" />
        {onBehalf && <Input label={t("leave.enter.sanctionRef")} value={v.sanctionRef} onChange={(e) => setV({ ...v, sanctionRef: e.target.value })} error={errors.sanctionRef} required containerClassName="sm:col-span-2" />}
        {!onBehalf && rule?.needsCertificate && (
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="leave-certificate" className="text-sm font-medium text-ink-800">
              {t("leave.certificate")} <span className="text-red-600">*</span>
            </label>
            <input
              id="leave-certificate"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded-lg border border-ink-200 bg-white text-sm text-ink-700 file:mr-3 file:h-10 file:border-0 file:bg-brand-50 file:px-4 file:font-medium file:text-brand-800"
            />
            {errors.file && <p className="text-xs font-medium text-red-600">{errors.file}</p>}
          </div>
        )}
      </CardBody>
      <CardFooter>
        <Button variant="primary" icon={<Send className="size-4" />} loading={busy} disabled={!preview || (onBehalf && !employeeId)} onClick={submit}>
          {onBehalf ? t("leave.enter.send") : t("leave.send")}
        </Button>
      </CardFooter>
    </Card>
  );
}
