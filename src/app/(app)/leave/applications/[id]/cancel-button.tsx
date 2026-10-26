"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarX2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";

export function CancelLeaveButton({ id }: { id: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function cancel() {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/api/v1/leave/applications/${id}/cancel`, { body: { note } });
      toast(t("leave.cancelled"));
      setOpen(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.fields.note ? err.message : undefined);
        toast(err.message, "error");
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="danger" icon={<CalendarX2 className="size-4" />} onClick={() => setOpen(true)}>
        {t("leave.cancel")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("leave.cancel")}
        description={t("leave.cancelHint")}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.back")}
            </Button>
            <Button variant="danger" loading={busy} onClick={cancel}>
              {t("leave.cancel")}
            </Button>
          </>
        }
      >
        <Textarea label={t("leave.cancelNote")} value={note} onChange={(e) => setNote(e.target.value)} error={error} required rows={3} />
      </Dialog>
    </>
  );
}
