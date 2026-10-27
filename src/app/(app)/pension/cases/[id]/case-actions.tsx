"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Banknote, Check, CircleAlert, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";

/** PN-07: one section's answer to the no-dues checklist. */
export function NoDuesButtons({ caseId, sectionId, section }: { caseId: string; sectionId: string; section: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: "", note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function save(status: "CLEAR" | "DUES") {
    setBusy(status);
    setErrors({});
    try {
      await api(`/api/v1/pension/cases/${caseId}/no-dues/${sectionId}`, { method: "PUT", body: status === "CLEAR" ? { status } : { status, amount: form.amount, note: form.note } });
      toast(t("pension.case.noDuesSaved"));
      setOpen(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        toast(err.message, "error");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" icon={<Check className="size-4" />} loading={busy === "CLEAR"} onClick={() => save("CLEAR")}>
        {t("pension.case.clear")}
      </Button>
      <Button size="sm" variant="ghost" icon={<CircleAlert className="size-4" />} onClick={() => setOpen(true)}>
        {t("pension.case.dues")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closeLabel={t("common.close")}
        title={t("pension.case.duesTitle", { section })}
        description={t("pension.case.duesHelp")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy === "DUES"} onClick={() => save("DUES")}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Input label={t("pension.case.duesAmount")} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} error={errors.amount} inputMode="decimal" required />
          <Textarea label={t("pension.case.duesNote")} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} error={errors.note} required maxLength={300} />
        </div>
      </Dialog>
    </div>
  );
}

/** PN-09: send the case to a Checker. */
export function SubmitCase({ caseId, ready }: { caseId: string; ready: boolean }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-3">
      <Textarea label={t("payroll.actions.noteForChecker")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} />
      <div>
        <Button
          variant="primary"
          icon={<Send className="size-4" />}
          disabled={!ready}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/api/v1/pension/cases/${caseId}/submit`, { body: { note: note.trim() || undefined } });
              toast(t("pension.case.sent"));
              router.refresh();
            } catch (err) {
              if (err instanceof ApiError) toast(err.message, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("payroll.actions.sendToChecker")}
        </Button>
        {!ready && <p className="mt-2 text-xs text-amber-700">{t("pension.errors.noDuesPending")}</p>}
      </div>
    </div>
  );
}

/** PN-10: make the retirement benefits bill and open it. */
export function BenefitsButton({ caseId }: { caseId: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      icon={<Banknote className="size-4" />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api<{ id: string }>(`/api/v1/pension/cases/${caseId}/benefits`, { body: {} });
          toast(t("pension.case.benefitsMade"));
          router.push(`/pension/bills/${r.id}`);
        } catch (err) {
          if (err instanceof ApiError) toast(err.message, "error");
          setBusy(false);
        }
      }}
    >
      {t("pension.case.makeBenefits")}
    </Button>
  );
}
