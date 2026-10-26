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

/** PR-02: propose a new value for a rate from a date (a DA order, a new ceiling…). */
export function RateButton({ rateKey, name, unit, current }: { rateKey: string; name: string; unit: string; current: number | null }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ value: current === null ? "" : String(current), effectiveFrom: "", note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setErrors({});
    try {
      await api("/api/v1/rates", { body: { key: rateKey, ...form } });
      toast(t("rates.sent"));
      setOpen(false);
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
      <Button size="sm" variant="ghost" icon={<PencilLine className="size-4" />} onClick={() => setOpen(true)}>
        {t("rates.propose")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closeLabel={t("common.close")}
        title={t("rates.proposeTitle", { name })}
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={`${t("rates.newValue")} (${unit === "PERCENT" ? "%" : "₹"})`} inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} error={errors.value} required />
          <Input label={t("rates.effectiveFrom")} type="date" hint={t("rates.effectiveHelp")} value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} error={errors.effectiveFrom} required />
          <Input label={t("rates.order")} hint={t("rates.orderHelp")} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} error={errors.note} className="sm:col-span-2" maxLength={300} required />
        </div>
      </Dialog>
    </>
  );
}
