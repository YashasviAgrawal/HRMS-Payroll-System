"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/http";
import { useT } from "@/lib/i18n/client";

/** S-40 stage 1: work out a pay group's month (again, while it is a draft). */
export function RunButton({ payGroup, month, again, variant = "primary", size = "md" }: { payGroup: string; month: string; again?: boolean; variant?: "primary" | "secondary"; size?: "sm" | "md" }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const r = await api<{ id: string }>("/api/v1/payroll/runs", { body: { payGroup, month } });
      toast(payGroup === "PENSION" ? t("pension.bills.runDone") : t("payroll.runDone"));
      router.push(`${payGroup === "PENSION" ? "/pension/bills" : "/payroll"}/${r.id}`);
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("errors.generic"), "error");
      setBusy(false);
    }
  }

  return (
    <Button variant={variant} size={size} loading={busy} icon={again ? <RefreshCw className="size-4" /> : <Play className="size-4" />} onClick={run}>
      {payGroup === "PENSION" ? (again ? t("pension.bills.runAgain") : t("pension.bills.run")) : again ? t("payroll.runAgain") : t("payroll.run")}
    </Button>
  );
}
