"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";

/** ST-04: salary and TDS of the year paid outside this system, sent to a Checker. */
export function CarryInForm({ employeeId, fy, initial }: { employeeId: string; fy: string; initial: { salary: number; tds: number; note: string } | null }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ salary: initial ? String(initial.salary) : "", tds: initial ? String(initial.tds) : "", note: initial?.note ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    setErrors({});
    try {
      await api("/api/v1/statutory/carry-in", { body: { employeeId, fy, ...form } });
      toast(t("statutory.tax.carryInSent"));
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
    <div className="grid gap-4 sm:grid-cols-3">
      <Input label={t("statutory.tax.carryInSalary")} inputMode="decimal" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} error={errors.salary} required />
      <Input label={t("statutory.tax.carryInTds")} inputMode="decimal" value={form.tds} onChange={(e) => setForm({ ...form, tds: e.target.value })} error={errors.tds} required />
      <Input label={t("statutory.tax.carryInNote")} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} error={errors.note} maxLength={200} required />
      <div className="sm:col-span-3">
        <Button variant="secondary" icon={<Send className="size-4" />} loading={busy} onClick={send}>
          {t("statutory.tax.carryInSend")}
        </Button>
      </div>
    </div>
  );
}
