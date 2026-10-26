"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { HandCoins, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";
import { formatINR } from "@/lib/money";

/** §9 GPF: sanction an advance (paid back in 12–60 instalments) or a withdrawal; a Checker then an Admin approve. */
export function GpfAdvanceForm({ employeeId, limits, today }: { employeeId: string; limits: { advance: number; withdrawal: number; advancePercent: number; withdrawalPercent: number }; today: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ kind: "ADVANCE" as "ADVANCE" | "WITHDRAWAL", amount: "", instalments: "24", purpose: "", orderNumber: "", sanctionDate: today });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const instalment = form.kind === "ADVANCE" && Number(form.amount) > 0 && Number(form.instalments) >= 12 ? Math.ceil(Number(form.amount) / Number(form.instalments)) : null;

  async function send() {
    setBusy(true);
    setErrors({});
    try {
      await api("/api/v1/statutory/gpf/advances", { body: { ...form, employeeId, instalments: form.kind === "ADVANCE" ? form.instalments : "0" } });
      toast(t("statutory.sentToChecker"));
      setForm((f) => ({ ...f, amount: "", purpose: "", orderNumber: "" }));
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
      <CardHeader
        title={t("statutory.gpf.sanction")}
        description={t("statutory.gpf.sanctionHelp", { advance: formatINR(limits.advance), ap: limits.advancePercent, withdrawal: formatINR(limits.withdrawal), wp: limits.withdrawalPercent })}
        icon={<HandCoins className="size-4.5" aria-hidden="true" />}
      />
      <CardBody className="grid gap-4 sm:grid-cols-3">
        <Select label={t("statutory.gpf.kind")} value={form.kind} onChange={(e) => set({ kind: e.target.value as "ADVANCE" | "WITHDRAWAL" })}>
          <option value="ADVANCE">{t("statutory.gpf.advanceKinds.ADVANCE")}</option>
          <option value="WITHDRAWAL">{t("statutory.gpf.advanceKinds.WITHDRAWAL")}</option>
        </Select>
        <Input label={t("statutory.amount")} inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} error={errors.amount} required />
        {form.kind === "ADVANCE" ? (
          <Input label={t("statutory.gpf.instalments")} inputMode="numeric" value={form.instalments} onChange={(e) => set({ instalments: e.target.value })} error={errors.instalments} hint={instalment ? t("statutory.gpf.instalmentEach", { amount: formatINR(instalment) }) : undefined} required />
        ) : (
          <div className="hidden sm:block" />
        )}
        <Input label={t("statutory.gpf.order")} value={form.orderNumber} onChange={(e) => set({ orderNumber: e.target.value })} error={errors.orderNumber} maxLength={80} required />
        <Input label={t("statutory.gpf.sanctionDate")} type="date" value={form.sanctionDate} onChange={(e) => set({ sanctionDate: e.target.value })} error={errors.sanctionDate} required />
        <Input label={t("statutory.gpf.purpose")} value={form.purpose} onChange={(e) => set({ purpose: e.target.value })} error={errors.purpose} maxLength={200} required />
      </CardBody>
      <CardFooter>
        <Button variant="primary" icon={<Send className="size-4" />} loading={busy} onClick={send}>
          {t("statutory.gpf.send")}
        </Button>
      </CardFooter>
    </Card>
  );
}
