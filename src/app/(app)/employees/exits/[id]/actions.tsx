"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Banknote, Plus, ReceiptIndianRupee, Save, Send, Trash2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useI18n, useT } from "@/lib/i18n/client";
import { formatINR } from "@/lib/money";
import { formatMonth } from "@/lib/dates";
import { msg } from "../../_components/fields";

function useAction() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function run(key: string, fn: () => Promise<unknown>, done: string, after?: () => void) {
    setBusy(key);
    setErrors({});
    try {
      await fn();
      toast(done);
      after?.();
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        toast(err.message, "error");
      } else toast(t("errors.generic"), "error");
    } finally {
      setBusy(null);
    }
  }
  return { t, busy, errors, run };
}

/** HR asks to reinstate a suspended employee, with the order. */
export function ReinstateDialog({ id }: { id: string }) {
  const { t, busy, errors, run } = useAction();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ reinstatedOn: "", orderNumber: "", orderDate: "", note: "" });
  const set = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <>
      <Button variant="primary" icon={<UserCheck className="size-4" />} onClick={() => setOpen(true)}>
        {t("employees.exit.reinstate")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closeLabel={t("common.close")}
        title={t("employees.exit.reinstate")}
        description={t("employees.exit.reinstateHelp")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy === "reinstate"} onClick={() => run("reinstate", () => api(`/api/v1/separations/${id}/reinstate`, { body: v }), t("employees.exit.sent"), () => setOpen(false))}>
              {t("employees.edit.submit")}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label={t("employees.exit.reinstatedOn")} type="date" value={v.reinstatedOn} onChange={(e) => set("reinstatedOn", e.target.value)} error={msg(t, errors.reinstatedOn)} required containerClassName="sm:col-span-2" />
          <Input label={t("employees.serviceBook.orderNo")} value={v.orderNumber} onChange={(e) => set("orderNumber", e.target.value)} error={msg(t, errors.orderNumber)} required />
          <Input label={t("employees.serviceBook.orderDate")} type="date" value={v.orderDate} onChange={(e) => set("orderDate", e.target.value)} error={msg(t, errors.orderDate)} required />
          <Textarea label={t("employees.exit.reinstateNote")} value={v.note} onChange={(e) => set("note", e.target.value)} error={msg(t, errors.note)} required maxLength={500} containerClassName="sm:col-span-2" />
        </div>
      </Dialog>
    </>
  );
}

interface Inputs {
  leaveDays?: number | null;
  leaveNote: string | null;
  lines: { kind: "DUE" | "RECOVERY"; label: string; amount: number }[];
  withheld: Record<string, boolean>;
}

/** The Payroll clerk's entries on a draft statement: leave days by order, withheld pay released or not, lines by hand. */
export function SettlementEditor({
  id,
  inputs,
  ruleDays,
  hasLeave,
  withheld,
  canSubmit,
}: {
  id: string;
  inputs: Inputs;
  ruleDays: number;
  hasLeave: boolean;
  withheld: { slipId: string; month: string; due: number; release: boolean; notDue: boolean; reason: string | null }[];
  canSubmit: boolean;
}) {
  const { t, busy, errors, run } = useAction();
  const { locale } = useI18n();
  const [leaveDays, setLeaveDays] = useState(inputs.leaveDays === null || inputs.leaveDays === undefined ? "" : String(inputs.leaveDays));
  const [leaveNote, setLeaveNote] = useState(inputs.leaveNote ?? "");
  const [lines, setLines] = useState(inputs.lines.map((l) => ({ ...l, amount: String(l.amount) })));
  const [held, setHeld] = useState<Record<string, boolean>>(Object.fromEntries(withheld.map((w) => [w.slipId, w.release])));
  const [note, setNote] = useState("");
  const body = () => ({
    leaveDays: leaveDays === "" ? null : leaveDays,
    leaveNote: leaveNote || null,
    lines: lines.filter((l) => l.label.trim() || l.amount).map((l) => ({ ...l, amount: l.amount })),
    withheld: held,
  });
  const lineError = (i: number, k: string) => msg(t, errors[`lines.${i}.${k}`]);
  return (
    <div className="space-y-5" data-testid="settlement-editor">
      {hasLeave && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={t("payroll.settlement.leaveDays")}
            hint={t("payroll.settlement.leaveDaysHint", { days: ruleDays })}
            value={leaveDays}
            onChange={(e) => setLeaveDays(e.target.value)}
            inputMode="decimal"
            placeholder={String(ruleDays)}
            error={msg(t, errors.leaveDays)}
            optionalLabel={t("common.optional")}
          />
          <Input label={t("payroll.settlement.leaveNote")} value={leaveNote} onChange={(e) => setLeaveNote(e.target.value)} error={msg(t, errors.leaveNote)} optionalLabel={t("common.optional")} maxLength={300} />
        </div>
      )}

      {withheld.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-ink-900">{t("payroll.settlement.withheldTitle")}</legend>
          {withheld.map((w) => (
            <Checkbox
              key={w.slipId}
              label={`${formatMonth(w.month, locale)} — ${formatINR(w.due)}`}
              description={w.notDue ? t("payroll.settlement.withheldNotDue") : w.reason ? t("payroll.settlement.withheldReason", { reason: w.reason }) : undefined}
              checked={!w.notDue && Boolean(held[w.slipId])}
              disabled={w.notDue}
              onChange={(e) => setHeld((h) => ({ ...h, [w.slipId]: e.target.checked }))}
            />
          ))}
        </fieldset>
      )}

      <div>
        <p className="mb-1 text-sm font-medium text-ink-900">{t("payroll.settlement.byHand")}</p>
        <p className="mb-3 text-sm text-ink-500">{t("payroll.settlement.byHandHelp")}</p>
        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-1 items-start gap-3 rounded-xl border border-ink-100 p-3 sm:grid-cols-[10rem_minmax(0,1fr)_9rem_auto]">
              <Select label={t("common.type")} value={l.kind} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, kind: e.target.value as "DUE" | "RECOVERY" } : x)))}>
                <option value="DUE">{t("payroll.settlement.due")}</option>
                <option value="RECOVERY">{t("payroll.settlement.recovery")}</option>
              </Select>
              <Input label={t("payroll.settlement.lineLabel")} value={l.label} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} error={lineError(i, "label")} maxLength={120} />
              <Input label={t("payroll.settlement.amount")} value={l.amount} inputMode="decimal" onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} error={lineError(i, "amount")} />
              <button type="button" className="mt-7 rounded-lg p-2 text-ink-400 hover:bg-red-50 hover:text-red-600" aria-label={t("payroll.settlement.removeLine")} title={t("payroll.settlement.removeLine")} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
        {lines.length < 20 && (
          <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...ls, { kind: "RECOVERY", label: "", amount: "" }])}>
            {t("payroll.settlement.addLine")}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-ink-100 pt-4">
        <Button variant="secondary" icon={<Save className="size-4" />} loading={busy === "save"} onClick={() => run("save", () => api(`/api/v1/separations/${id}/settlement`, { method: "PUT", body: body() }), t("payroll.settlement.saved"))}>
          {t("payroll.settlement.save")}
        </Button>
        <Input label={t("payroll.settlement.noteForChecker")} value={note} onChange={(e) => setNote(e.target.value)} optionalLabel={t("common.optional")} containerClassName="min-w-56 flex-1" maxLength={500} />
        <Button
          variant="primary"
          icon={<Send className="size-4" />}
          disabled={!canSubmit}
          loading={busy === "submit"}
          onClick={() =>
            run(
              "submit",
              async () => {
                await api(`/api/v1/separations/${id}/settlement`, { method: "PUT", body: body() });
                await api(`/api/v1/separations/${id}/settlement/submit`, { body: { note: note || null } });
              },
              t("payroll.settlement.submitted"),
            )
          }
        >
          {t("payroll.settlement.submit")}
        </Button>
      </div>
    </div>
  );
}

/** Payroll makes the settlement bill once the statement is approved. */
export function MakeBillButton({ id }: { id: string }) {
  const { t, busy, run } = useAction();
  const router = useRouter();
  return (
    <Button
      variant="primary"
      icon={<Banknote className="size-4" />}
      loading={busy === "bill"}
      onClick={() =>
        run(
          "bill",
          async () => {
            const r = await api<{ runId: string }>(`/api/v1/separations/${id}/settlement/bill`, { body: {} });
            router.push(`/payroll/${r.runId}`);
          },
          t("payroll.settlement.billMade"),
        )
      }
    >
      {t("payroll.settlement.makeBill")}
    </Button>
  );
}

/** Money paid back by the person, receipt by receipt. */
export function ReceiptDialog({ id, left }: { id: string; left: number }) {
  const { t, busy, errors, run } = useAction();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ receiptNo: "", date: "", amount: String(left) });
  const set = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <>
      <Button variant="primary" icon={<ReceiptIndianRupee className="size-4" />} onClick={() => setOpen(true)}>
        {t("payroll.settlement.recordReceipt")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closeLabel={t("common.close")}
        title={t("payroll.settlement.recordReceipt")}
        description={t("payroll.settlement.receiptHelp", { amount: formatINR(left) })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy === "receipt"} onClick={() => run("receipt", () => api(`/api/v1/separations/${id}/settlement/receipts`, { body: v }), t("payroll.settlement.receiptSaved"), () => setOpen(false))}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input label={t("payroll.settlement.receiptNo")} value={v.receiptNo} onChange={(e) => set("receiptNo", e.target.value)} error={msg(t, errors.receiptNo)} required />
          <Input label={t("payroll.settlement.receiptDate")} type="date" value={v.date} onChange={(e) => set("date", e.target.value)} error={msg(t, errors.date)} required />
          <Input label={t("payroll.settlement.amount")} value={v.amount} inputMode="decimal" onChange={(e) => set("amount", e.target.value)} error={msg(t, errors.amount)} required />
        </div>
      </Dialog>
    </>
  );
}
