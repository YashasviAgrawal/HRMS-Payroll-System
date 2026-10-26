"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";

export function ReopenButton({ sectionId, month }: { sectionId: string; month: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      await api("/api/v1/attendance/unlock", { body: { sectionId, month, reason } });
      toast(t("attendance.lock.reopenSent"));
      setOpen(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.fields.reason ? err.message : undefined);
        toast(err.message, "error");
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button size="sm" variant="ghost" icon={<LockOpen className="size-4" />} onClick={() => setOpen(true)}>
        {t("attendance.lock.reopen")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("attendance.lock.reopenTitle")}
        description={t("attendance.lock.reopenHint")}
        closeLabel={t("common.close")}
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
        <Textarea label={t("attendance.lock.reason")} value={reason} onChange={(e) => setReason(e.target.value)} error={error} required rows={3} />
      </Dialog>
    </>
  );
}
