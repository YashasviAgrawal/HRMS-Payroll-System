"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PencilLine, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";
import type { Regime, TaxRuleSet } from "@/modules/statutory/tax-rules";

/** ST-01: propose new slabs and limits for a year and regime (a Finance Act change); an Admin approves. */
export function TaxRuleButton({ fy, regime, rules }: { fy: string; regime: Regime; rules: TaxRuleSet }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const start = () => ({
    slabs: rules.slabs.map((s) => ({ upTo: s.upTo === null ? "" : String(s.upTo), rate: String(s.rate) })),
    standardDeduction: String(rules.standardDeduction),
    rebateIncomeLimit: String(rules.rebateIncomeLimit),
    rebateMax: String(rules.rebateMax),
    cessPercent: String(rules.cessPercent),
    reason: "",
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const setSlab = (i: number, patch: Partial<{ upTo: string; rate: string }>) => setForm((f) => ({ ...f, slabs: f.slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  async function send() {
    setBusy(true);
    setErrors({});
    try {
      await api("/api/v1/statutory/rules/tax", {
        body: { fy, regime, ...form, slabs: form.slabs.map((s, i) => ({ upTo: i === form.slabs.length - 1 ? null : s.upTo === "" ? null : Number(s.upTo), rate: Number(s.rate) })) },
      });
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
      <Button size="sm" variant="ghost" icon={<PencilLine className="size-4" />} onClick={() => (setForm(start()), setErrors({}), setOpen(true))}>
        {t("statutory.rules.edit")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closeLabel={t("common.close")}
        size="lg"
        title={t("statutory.rules.editTitle", { fy, regime: t(`statutory.tax.regimes.${regime}`) })}
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
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-ink-800">{t("statutory.rules.slabs")}</legend>
          {form.slabs.map((s, i) => {
            const last = i === form.slabs.length - 1;
            return (
              <div key={i} className="grid grid-cols-[1fr_7rem_auto] items-end gap-2">
                {last ? (
                  <Input label={t("statutory.rules.upTo")} value={t("statutory.rules.above")} disabled />
                ) : (
                  <Input label={t("statutory.rules.upTo")} inputMode="numeric" value={s.upTo} onChange={(e) => setSlab(i, { upTo: e.target.value.replace(/\D/g, "") })} />
                )}
                <Input label={t("statutory.rules.ratePct")} inputMode="decimal" value={s.rate} onChange={(e) => setSlab(i, { rate: e.target.value })} />
                <Button variant="ghost" size="sm" aria-label={t("common.remove")} disabled={form.slabs.length <= 2} icon={<Trash2 className="size-4" />} onClick={() => setForm((f) => ({ ...f, slabs: f.slabs.filter((_, j) => j !== i) }))} />
              </div>
            );
          })}
          {errors.slabs && <p className="text-sm text-red-700">{errors.slabs}</p>}
          <Button variant="ghost" size="sm" icon={<Plus className="size-4" />} onClick={() => setForm((f) => ({ ...f, slabs: [...f.slabs.slice(0, -1), { upTo: "", rate: "" }, f.slabs.at(-1)!] }))}>
            {t("statutory.rules.addSlab")}
          </Button>
        </fieldset>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label={t("statutory.rules.standardDeduction")} inputMode="numeric" value={form.standardDeduction} onChange={(e) => setForm({ ...form, standardDeduction: e.target.value })} error={errors.standardDeduction} />
          <Input label={t("statutory.rules.cessPct")} inputMode="decimal" value={form.cessPercent} onChange={(e) => setForm({ ...form, cessPercent: e.target.value })} error={errors.cessPercent} />
          <Input label={t("statutory.rules.rebateLimit")} inputMode="numeric" value={form.rebateIncomeLimit} onChange={(e) => setForm({ ...form, rebateIncomeLimit: e.target.value })} error={errors.rebateIncomeLimit} />
          <Input label={t("statutory.rules.rebateMax")} inputMode="numeric" value={form.rebateMax} onChange={(e) => setForm({ ...form, rebateMax: e.target.value })} error={errors.rebateMax} />
          <Input label={t("statutory.rules.reason")} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} error={errors.reason} containerClassName="sm:col-span-2" maxLength={200} required />
        </div>
      </Dialog>
    </>
  );
}
