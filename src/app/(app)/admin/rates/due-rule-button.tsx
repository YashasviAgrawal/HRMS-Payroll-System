"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";

/** ST-01, ST-08: propose a new due date for a filing; an Admin approves. */
export function DueRuleButton({ code, name, kind, day, dates }: { code: string; name: string; kind: string; day: number; dates: string[] }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const periodic = kind === "MONTHLY" || kind === "AFTER_PAY";
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ day: String(day), dates: dates.join(", "), reason: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setErrors({});
    try {
      await api("/api/v1/statutory/rules/dues", { body: { code, day: periodic ? form.day : 0, dates: periodic ? [] : form.dates.split(/[,\s]+/).filter(Boolean), reason: form.reason } });
      toast(t("rates.sent"));
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
      <Button size="sm" variant="ghost" icon={<PencilLine className="size-4" />} onClick={() => setOpen(true)}>
        {t("rates.propose")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closeLabel={t("common.close")}
        title={name}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={send}>
              {t("common.submit")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {periodic ? (
            <Input label={t("statutory.rules.day")} inputMode="numeric" value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value.replace(/\D/g, "") })} error={errors.day} required />
          ) : (
            <Input label={t("statutory.rules.dates")} value={form.dates} onChange={(e) => setForm({ ...form, dates: e.target.value })} error={errors.dates} required />
          )}
          <Input label={t("rates.order")} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} error={errors.reason} maxLength={200} required />
        </div>
      </Dialog>
    </>
  );
}
