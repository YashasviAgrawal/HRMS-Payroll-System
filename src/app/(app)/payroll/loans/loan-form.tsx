"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { HandCoins, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { formatMonth } from "@/lib/dates";
import { ApiError, api } from "@/lib/http";
import { useI18n } from "@/lib/i18n/client";
import { formatINR } from "@/lib/money";

const TYPES = ["HBA", "VEHICLE", "COMPUTER", "FESTIVAL", "OTHER"] as const;

/** PR-09: sanction a loan with a live schedule; a Checker checks and an Admin approves. */
export function LoanForm({ employees, startMonth }: { employees: { id: string; label: string }[]; startMonth: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ employeeId: "", type: "FESTIVAL" as (typeof TYPES)[number], purpose: "", principal: "", interestRate: "0", instalments: "10", startMonth, sanctionDate: "", orderNumber: "" });
  const [preview, setPreview] = useState<{ instalmentAmount: number; months: number; interest: number; total: number; lastMonth: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const ok = Number(form.principal) > 0 && Number(form.instalments) > 0 && /^\d{4}-\d{2}$/.test(form.startMonth);
  useEffect(() => {
    if (!ok) return;
    const h = setTimeout(async () => {
      try {
        setPreview(await api("/api/v1/payroll/loans/preview", { body: { ...form, employeeId: form.employeeId || "x", sanctionDate: form.sanctionDate || "2000-01-01", orderNumber: form.orderNumber || "xxx" } }));
      } catch {
        setPreview(null);
      }
    }, 350);
    return () => clearTimeout(h);
  }, [form, ok]);

  async function send() {
    setBusy(true);
    setErrors({});
    try {
      await api("/api/v1/payroll/loans", { body: { ...form, purpose: form.purpose || undefined } });
      toast(t("payroll.loans.sent"));
      setForm((f) => ({ ...f, employeeId: "", principal: "", purpose: "", orderNumber: "" }));
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
      <CardHeader title={t("payroll.loans.sanction")} description={t("payroll.loans.sanctionHelp")} icon={<HandCoins className="size-4.5" aria-hidden="true" />} />
      <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Select label={t("payroll.items.employee")} value={form.employeeId} onChange={(e) => set({ employeeId: e.target.value })} error={errors.employeeId} containerClassName="sm:col-span-2" required>
          <option value="">{t("payroll.items.pick")}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </Select>
        <Select label={t("payroll.loans.type")} value={form.type} onChange={(e) => set({ type: e.target.value as (typeof TYPES)[number], interestRate: e.target.value === "FESTIVAL" ? "0" : form.interestRate })}>
          {TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`payroll.loans.types.${x}`)}
            </option>
          ))}
        </Select>
        <Input label={t("payroll.loans.principal")} inputMode="decimal" value={form.principal} onChange={(e) => set({ principal: e.target.value })} error={errors.principal} required />
        <Input label={t("payroll.loans.interestRate")} inputMode="decimal" value={form.interestRate} onChange={(e) => set({ interestRate: e.target.value })} error={errors.interestRate} />
        <Input label={t("payroll.loans.instalments")} inputMode="numeric" value={form.instalments} onChange={(e) => set({ instalments: e.target.value })} error={errors.instalments} required />
        <Input label={t("payroll.loans.startMonth")} type="month" value={form.startMonth} onChange={(e) => set({ startMonth: e.target.value })} error={errors.startMonth} required />
        <Input label={t("payroll.loans.sanctionDate")} type="date" value={form.sanctionDate} onChange={(e) => set({ sanctionDate: e.target.value })} error={errors.sanctionDate} required />
        <Input label={t("payroll.loans.order")} value={form.orderNumber} onChange={(e) => set({ orderNumber: e.target.value })} error={errors.orderNumber} maxLength={80} required />
        <Input label={t("payroll.loans.purpose")} value={form.purpose} onChange={(e) => set({ purpose: e.target.value })} error={errors.purpose} containerClassName="sm:col-span-3" maxLength={200} />
      </CardBody>
      {ok && preview && (
        <CardBody className="border-t border-ink-100 bg-brand-50/30 py-3">
          <p className="text-sm text-ink-800" aria-live="polite">
            {t("payroll.loans.previewText", { amount: formatINR(preview.instalmentAmount), months: preview.months, last: formatMonth(preview.lastMonth, locale), interest: formatINR(preview.interest), total: formatINR(preview.total) })}
          </p>
        </CardBody>
      )}
      <CardFooter>
        <Button variant="primary" icon={<Send className="size-4" />} loading={busy} onClick={send}>
          {t("payroll.loans.send")}
        </Button>
      </CardFooter>
    </Card>
  );
}
