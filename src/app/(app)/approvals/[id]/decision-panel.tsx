"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, CornerUpLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";

export function DecisionPanel({ taskId, makerName }: { taskId: string; makerName: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  async function decide(decision: "APPROVE" | "REJECT" | "RETURN") {
    if (decision !== "APPROVE" && !note.trim()) {
      setError(t("approvals.noteRequired"));
      return;
    }
    const question = decision === "APPROVE" ? t("approvals.approveConfirm") : decision === "REJECT" ? t("approvals.rejectConfirm") : t("approvals.sendBackConfirm", { name: makerName });
    if (!window.confirm(question)) return;
    setBusy(decision);
    setError(undefined);
    try {
      await api(`/api/v1/approvals/${taskId}/decision`, { body: { decision, note: note.trim() || undefined } });
      toast(decision === "APPROVE" ? t("approvals.approved") : decision === "REJECT" ? t("approvals.rejected") : t("approvals.returned"));
      router.push("/approvals");
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader title={t("approvals.decide")} />
      <CardBody>
        <Textarea label={t("common.remarks")} placeholder={t("approvals.remarksPlaceholder")} value={note} onChange={(e) => setNote(e.target.value)} error={error} maxLength={1000} />
      </CardBody>
      <CardFooter className="justify-between">
        <div className="flex gap-2">
          <Button variant="danger" icon={<X className="size-4" />} loading={busy === "REJECT"} disabled={Boolean(busy)} onClick={() => decide("REJECT")}>
            {t("common.reject")}
          </Button>
          <Button variant="secondary" icon={<CornerUpLeft className="size-4" />} loading={busy === "RETURN"} disabled={Boolean(busy)} onClick={() => decide("RETURN")}>
            {t("common.sendBack")}
          </Button>
        </div>
        <Button variant="primary" icon={<Check className="size-4" />} loading={busy === "APPROVE"} disabled={Boolean(busy)} onClick={() => decide("APPROVE")}>
          {t("common.approve")}
        </Button>
      </CardFooter>
    </Card>
  );
}
