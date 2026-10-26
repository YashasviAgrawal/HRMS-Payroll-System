"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatMonth } from "@/lib/dates";
import { ApiError, api } from "@/lib/http";
import { useI18n } from "@/lib/i18n/client";

/** ST-05: record a challan against a month's TDS; cess is filled in from the 4% share of the amount due. */
export function ChallanDialog({ months, initialMonth }: { months: { month: string; due: number }[]; initialMonth?: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const first = initialMonth ?? months.find((m) => m.due > 0)?.month ?? months.at(-1)?.month ?? "";
  const split = (due: number) => {
    const cess = Math.round((due * 4) / 104);
    return { tax: due > 0 ? String(due - cess) : "", cess: due > 0 ? String(cess) : "" };
  };
  const blank = (month: string) => ({ month, bsrCode: "", challanNo: "", depositedOn: "", interest: "0", ...split(months.find((m) => m.month === month)?.due ?? 0) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => blank(first));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await api("/api/v1/statutory/tds/challans", { body: form });
      toast(t("statutory.tds.recorded"));
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
      <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => (setForm(blank(first)), setErrors({}), setOpen(true))}>
        {t("statutory.tds.record")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("statutory.tds.record")}
        description={t("statutory.tds.recordHelp")}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={save}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label={t("statutory.tds.forMonth")} value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value, ...split(months.find((m) => m.month === e.target.value)?.due ?? 0) })} error={errors.month} containerClassName="sm:col-span-2">
            {months.map((m) => (
              <option key={m.month} value={m.month}>
                {formatMonth(m.month, locale)}
              </option>
            ))}
          </Select>
          <Input label={t("statutory.tds.bsr")} inputMode="numeric" maxLength={7} value={form.bsrCode} onChange={(e) => set({ bsrCode: e.target.value.replace(/\D/g, "") })} error={errors.bsrCode} required />
          <Input label={t("statutory.tds.challanNo")} inputMode="numeric" maxLength={5} value={form.challanNo} onChange={(e) => set({ challanNo: e.target.value.replace(/\D/g, "") })} error={errors.challanNo} required />
          <Input label={t("statutory.tds.depositedOn")} type="date" value={form.depositedOn} onChange={(e) => set({ depositedOn: e.target.value })} error={errors.depositedOn} required containerClassName="sm:col-span-2" />
          <Input label={t("statutory.tds.tax")} inputMode="decimal" value={form.tax} onChange={(e) => set({ tax: e.target.value })} error={errors.tax} required />
          <Input label={t("statutory.tds.cess")} inputMode="decimal" value={form.cess} onChange={(e) => set({ cess: e.target.value })} error={errors.cess} />
          <Input label={t("statutory.tds.interest")} inputMode="decimal" value={form.interest} onChange={(e) => set({ interest: e.target.value })} error={errors.interest} />
        </div>
      </Dialog>
    </>
  );
}
