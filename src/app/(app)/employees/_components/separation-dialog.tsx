"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { tDynamic } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { EXIT_KINDS } from "@/modules/payroll/settlement-rules";
import { msg } from "./fields";
import { uploadDoc } from "./widgets";

/** Client add-on: HR records a suspension or the person leaving service, with the order (Checker, then Admin). */
export function SeparationDialog({ employeeId, status }: { employeeId: string; status: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const kinds = status === "ACTIVE" ? (["SUSPENSION", ...EXIT_KINDS] as const) : EXIT_KINDS;
  const blank = { kind: kinds[0] as string, effectiveDate: "", orderNumber: "", orderDate: "", reason: "" };
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: x }));
  const suspension = v.kind === "SUSPENSION";

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      let documentId: string | null = null;
      const file = fileRef.current?.files?.[0];
      if (file) documentId = await uploadDoc(employeeId, file, "SERVICE_ORDER", `${tDynamic(t, `employees.exit.kind.${v.kind}`)} — ${v.orderNumber}`.trim());
      await api(`/api/v1/employees/${employeeId}/separations`, { body: { ...v, documentId } });
      toast(t("employees.exit.sent"));
      setOpen(false);
      setV(blank);
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
      <Button size="sm" variant="secondary" icon={<UserX className="size-4" />} onClick={() => setOpen(true)}>
        {t("employees.exit.record")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closeLabel={t("common.close")}
        title={t("employees.exit.record")}
        description={t("employees.exit.recordHelp")}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={save}>
              {t("employees.edit.submit")}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label={t("employees.exit.what")} value={v.kind} onChange={(e) => set("kind", e.target.value)} error={msg(t, errors.kind)} containerClassName="sm:col-span-2">
            {kinds.map((k) => (
              <option key={k} value={k}>
                {tDynamic(t, `employees.exit.kind.${k}`)}
              </option>
            ))}
          </Select>
          <Input
            label={suspension ? t("employees.exit.suspendedFrom") : t("employees.exit.lastDay")}
            hint={suspension ? undefined : t("employees.exit.lastDayHint")}
            type="date"
            value={v.effectiveDate}
            onChange={(e) => set("effectiveDate", e.target.value)}
            error={msg(t, errors.effectiveDate)}
            required
          />
          <Input label={t("employees.serviceBook.orderNo")} value={v.orderNumber} onChange={(e) => set("orderNumber", e.target.value)} error={msg(t, errors.orderNumber)} required />
          <Input label={t("employees.serviceBook.orderDate")} type="date" value={v.orderDate} onChange={(e) => set("orderDate", e.target.value)} error={msg(t, errors.orderDate)} required />
          <Input ref={fileRef} label={t("employees.exit.attachOrder")} type="file" accept="application/pdf,image/jpeg,image/png" optionalLabel={t("common.optional")} className="py-1.5" />
          <Textarea label={t("employees.exit.reason")} value={v.reason} onChange={(e) => set("reason", e.target.value)} error={msg(t, errors.reason)} required maxLength={500} containerClassName="sm:col-span-2" />
          <p className="rounded-lg bg-gold-50 px-3 py-2 text-sm text-gold-600 sm:col-span-2">{suspension ? t("employees.exit.suspensionNote") : t("employees.exit.leavingNote")}</p>
        </div>
      </Dialog>
    </>
  );
}
