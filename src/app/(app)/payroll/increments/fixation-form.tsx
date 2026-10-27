"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Calculator, Send, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/dates";
import { ApiError, api } from "@/lib/http";
import { useI18n } from "@/lib/i18n/client";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

interface Preview {
  current: { level: string; cell: number; basic: number; post: string; postHi: string };
  toPost: { name: string; nameHi: string } | null;
  fixation: {
    option: "FROM_PROMOTION" | "FROM_NEXT_INCREMENT";
    steps: { date: string; level: string; cell: number; basic: number; from: { level: string; cell: number; basic: number; notional: number } }[];
    incrementMonth: 1 | 7;
  };
  oldIncrementMonth: 1 | 7;
}

/** PR-07: work out the fixation with the rule shown, then send it to a Checker (and an Admin). */
export function FixationForm({ employees, posts, levels, canSend }: { employees: { id: string; label: string }[]; posts: { id: string; label: string; level: string }[]; levels: string[]; canSend: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ employeeId: "", kind: "PROMOTION" as "PROMOTION" | "MACP", toPostId: "", toLevel: "", effectiveFrom: "", option: "FROM_PROMOTION" as "FROM_PROMOTION" | "FROM_NEXT_INCREMENT", orderNumber: "", orderDate: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setPreview(null);
  };
  const body = () => ({ ...form, toPostId: form.kind === "PROMOTION" ? form.toPostId : undefined, orderDate: form.orderDate || undefined });

  async function call(kind: "preview" | "send") {
    setBusy(kind);
    setErrors({});
    try {
      if (kind === "preview") setPreview(await api<Preview>("/api/v1/payroll/fixation/preview", { body: body() }));
      else {
        await api("/api/v1/payroll/fixation", { body: body() });
        toast(t("payroll.fixation.sent"));
        setPreview(null);
        setForm((f) => ({ ...f, employeeId: "", orderNumber: "" }));
        router.refresh();
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

  const monthName = (m: 1 | 7) => (m === 1 ? t("payroll.fixation.january") : t("payroll.fixation.july"));

  return (
    <Card>
      <CardHeader title={t("payroll.fixation.title")} description={t("payroll.fixation.help")} icon={<Scale className="size-4.5" aria-hidden="true" />} />
      <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select label={t("payroll.items.employee")} value={form.employeeId} onChange={(e) => set({ employeeId: e.target.value })} error={errors.employeeId} containerClassName="sm:col-span-2" required>
          <option value="">{t("payroll.items.pick")}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </Select>
        <Select label={t("payroll.fixation.kind")} value={form.kind} onChange={(e) => set({ kind: e.target.value as "PROMOTION" | "MACP" })}>
          <option value="PROMOTION">{t("payroll.fixation.kinds.PROMOTION")}</option>
          <option value="MACP">{t("payroll.fixation.kinds.MACP")}</option>
        </Select>
        {form.kind === "PROMOTION" ? (
          <Select
            label={t("payroll.fixation.toPost")}
            value={form.toPostId}
            onChange={(e) => {
              const p = posts.find((x) => x.id === e.target.value);
              set({ toPostId: e.target.value, toLevel: p?.level ?? form.toLevel });
            }}
            error={errors.toPostId}
            required
          >
            <option value="">{t("common.choose")}</option>
            {posts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        ) : (
          <span className="hidden sm:block" />
        )}
        <Select label={t("payroll.fixation.toLevel")} value={form.toLevel} onChange={(e) => set({ toLevel: e.target.value })} error={errors.toLevel} required>
          <option value="">{t("common.choose")}</option>
          {levels.map((l) => (
            <option key={l} value={l}>
              {t("payroll.fixation.level", { level: l })}
            </option>
          ))}
        </Select>
        <Input label={t("payroll.fixation.effectiveFrom")} type="date" value={form.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} error={errors.effectiveFrom} required />
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-ink-800">{t("payroll.fixation.option")}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(["FROM_PROMOTION", "FROM_NEXT_INCREMENT"] as const).map((o) => (
              <label key={o} className={cn("flex cursor-pointer gap-3 rounded-xl border px-4 py-3", form.option === o ? "border-brand-500 bg-brand-50/50" : "border-ink-200 hover:border-ink-300")}>
                <input type="radio" name="option" className="mt-1 accent-brand-700" checked={form.option === o} onChange={() => set({ option: o })} />
                <span>
                  <span className="block text-sm font-semibold text-ink-900">{t(`payroll.fixation.options.${o}`)}</span>
                  <span className="block text-sm text-ink-600">{t(`payroll.fixation.rules.${o}`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Input label={t("payroll.fixation.orderNumber")} value={form.orderNumber} onChange={(e) => set({ orderNumber: e.target.value })} error={errors.orderNumber} maxLength={80} required />
        <Input label={t("payroll.fixation.orderDate")} type="date" value={form.orderDate} onChange={(e) => set({ orderDate: e.target.value })} error={errors.orderDate} />
      </CardBody>

      {preview && (
        <CardBody className="border-t border-ink-100 bg-brand-50/30">
          <h3 className="text-sm font-semibold text-ink-900">{t("payroll.fixation.result")}</h3>
          <p className="mt-1 text-sm text-ink-600">
            {t("payroll.fixation.now", { level: preview.current.level, cell: preview.current.cell, basic: formatINR(preview.current.basic), post: locale === "hi" ? preview.current.postHi : preview.current.post })}
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-ink-200 bg-white">
            <Table stack>
              <THead>
                <tr>
                  <Th>{t("payroll.fixation.from")}</Th>
                  <Th>{t("payroll.fixation.notional")}</Th>
                  <Th>{t("payroll.fixation.newPay")}</Th>
                </tr>
              </THead>
              <tbody>
                {preview.fixation.steps.map((s) => (
                  <Tr key={s.date}>
                    <Td className="font-medium">{formatDate(s.date, locale)}</Td>
                    <Td label={t("payroll.fixation.notional")}>
                      {t("payroll.fixation.notionalText", { amount: formatINR(s.from.notional), level: s.from.level })}
                    </Td>
                    <Td label={t("payroll.fixation.newPay")} className="font-semibold text-brand-800">
                      {t("payroll.fixation.cellText", { level: s.level, cell: s.cell, basic: formatINR(s.basic) })}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <p className="mt-3 text-sm text-ink-700">
            {t("payroll.fixation.incrementAfter", { month: monthName(preview.fixation.incrementMonth), before: monthName(preview.oldIncrementMonth) })}
          </p>
          <p className="mt-1 text-xs text-ink-500">{t(`payroll.fixation.rules.${preview.fixation.option}`)}</p>
        </CardBody>
      )}

      {canSend && (
        <CardFooter className="justify-between">
          <Button variant="secondary" icon={<Calculator className="size-4" />} loading={busy === "preview"} onClick={() => call("preview")}>
            {t("payroll.fixation.workOut")}
          </Button>
          <Button variant="primary" icon={<Send className="size-4" />} loading={busy === "send"} disabled={!preview} onClick={() => call("send")}>
            {t("payroll.fixation.send")}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
