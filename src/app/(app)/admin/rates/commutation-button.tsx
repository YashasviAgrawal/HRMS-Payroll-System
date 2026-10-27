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

/** PRD §10: propose a new commutation table from a date; an Admin approves. */
export function CommutationButton({ factors }: { factors: Record<string, number> }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const ages = Object.keys(factors).sort((a, b) => Number(a) - Number(b));
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(ages.map((a) => [a, String(factors[a])])));
  const [form, setForm] = useState({ effectiveFrom: "", reason: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setErrors({});
    try {
      await api("/api/v1/pension/tables", { body: { ...form, factors: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v])) } });
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
      <Button size="sm" variant="secondary" icon={<PencilLine className="size-4" />} onClick={() => setOpen(true)}>
        {t("rates.pension.propose")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closeLabel={t("common.close")}
        size="xl"
        title={t("rates.pension.proposeTitle")}
        description={t("rates.pension.proposeHelp")}
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
          <Input label={t("rates.from")} type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} error={errors.effectiveFrom} required />
          <Input label={t("rates.order")} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} error={errors.reason} required maxLength={200} />
        </div>
        {errors.factors && <p className="mt-3 text-sm text-red-700">{errors.factors}</p>}
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {ages.map((a) => (
            <Input key={a} label={t("rates.pension.age", { age: a })} value={values[a]} onChange={(e) => setValues({ ...values, [a]: e.target.value })} inputMode="decimal" className="h-9" />
          ))}
        </div>
      </Dialog>
    </>
  );
}
