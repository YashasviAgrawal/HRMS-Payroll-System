"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatMonth } from "@/lib/dates";
import { ApiError, api } from "@/lib/http";
import { useI18n } from "@/lib/i18n/client";
import { formatINR } from "@/lib/money";

type Row = { pensionerId: string; ppoNumber: string; name: string; nameHi: string | null; months: { month: string; lines: { code: string; diff: number }[] }[]; gross: number; deductions: number; net: number };

export function ArrearsForm({ from, to, max }: { from: string; to: string; max: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ fromMonth: from, toMonth: to, reason: "" });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function call(kind: "preview" | "make") {
    setBusy(kind);
    setErrors({});
    try {
      if (kind === "preview") setRows(await api<Row[]>("/api/v1/pension/arrears/preview", { body: form }));
      else {
        const r = await api<{ id: string }>("/api/v1/pension/arrears", { body: form });
        toast(t("pension.arrears.made"));
        router.push(`/pension/bills/${r.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        toast(err.message, "error");
      }
    } finally {
      setBusy(null);
    }
  }
  const total = rows?.reduce((s, r) => s + r.net, 0) ?? 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label={t("pension.arrears.from")} type="month" max={max} value={form.fromMonth} onChange={(e) => setForm({ ...form, fromMonth: e.target.value })} error={errors.fromMonth} required />
        <Input label={t("pension.arrears.to")} type="month" max={max} value={form.toMonth} onChange={(e) => setForm({ ...form, toMonth: e.target.value })} error={errors.toMonth} required />
        <Input label={t("pension.arrears.reason")} hint={t("pension.arrears.reasonHelp")} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} error={errors.reason} maxLength={200} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<Eye className="size-4" />} loading={busy === "preview"} onClick={() => call("preview")}>
          {t("pension.arrears.preview")}
        </Button>
        {rows && rows.length > 0 && (
          <Button variant="primary" icon={<HandCoins className="size-4" />} loading={busy === "make"} onClick={() => call("make")}>
            {t("pension.arrears.make", { count: rows.length, amount: formatINR(total) })}
          </Button>
        )}
      </div>
      {rows && rows.length === 0 && <p className="text-sm text-ink-600">{t("pension.arrears.none")}</p>}
      {rows && rows.length > 0 && (
        <Table stack>
          <THead>
            <tr>
              <Th>{t("pension.pensioners.pensioner")}</Th>
              <Th>{t("pension.arrears.months")}</Th>
              <Th align="right">{t("payroll.net")}</Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.pensionerId}>
                <Td>
                  <span className="font-medium text-ink-900">{locale === "hi" && r.nameHi ? r.nameHi : r.name}</span>
                  <span className="block text-xs text-ink-500">{r.ppoNumber}</span>
                </Td>
                <Td label={t("pension.arrears.months")} className="text-sm">
                  {r.months.map((m) => (
                    <span key={m.month} className="block">
                      {formatMonth(m.month, locale)}: {m.lines.map((l) => `${l.code} ${formatINR(l.diff)}`).join(", ")}
                    </span>
                  ))}
                </Td>
                <Td label={t("payroll.net")} align="right" className="font-semibold text-ink-950">
                  {formatINR(r.net)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
