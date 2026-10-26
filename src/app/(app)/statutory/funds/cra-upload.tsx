"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatMonth } from "@/lib/dates";
import { ApiError } from "@/lib/http";
import { useI18n } from "@/lib/i18n/client";
import { formatINR } from "@/lib/money";
import type { ReconLine } from "@/modules/statutory/stat-files";
import { upload } from "../_components/upload";

const TONE = { MATCHED: "green", DIFFERENT: "amber", NOT_CREDITED: "red", NOT_OURS: "gray" } as const;
type Summary = { matched: number; different: number; notCredited: number; notOurs: number };

/** §9 NPS: the CRA statement of credits, matched PRAN by PRAN with the pay bills. */
export function CraUpload() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ summary: Summary; lines: ReconLine[] } | null>(null);
  async function send(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const r = await upload<{ summary: Summary; lines: ReconLine[] }>("/api/v1/statutory/nps/reconcile", form);
      setResult(r);
      toast(t("statutory.nps.result", { ...r.summary }), r.summary.different + r.summary.notCredited ? "warning" : "success");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) toast(err.message, "error");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  const issues = result?.lines.filter((l) => l.status !== "MATCHED") ?? [];
  return (
    <div className="space-y-3">
      <input ref={input} id="cra-file" type="file" accept=".csv,.xlsx,text/csv" className="sr-only" onChange={(e) => send(e.target.files?.[0])} aria-label={t("statutory.nps.upload")} />
      <Button variant="secondary" icon={<FileUp className="size-4" />} loading={busy} onClick={() => input.current?.click()}>
        {t("statutory.nps.upload")}
      </Button>
      {result && (
        <div className="rounded-xl border border-ink-200 p-3 text-sm" data-testid="cra-result">
          <p className="font-medium text-ink-900">{t("statutory.nps.result", { ...result.summary })}</p>
          {issues.length === 0 ? (
            <p className="mt-1 text-brand-700">{t("statutory.nps.allMatched")}</p>
          ) : (
            <ul className="mt-2 divide-y divide-ink-100">
              {issues.slice(0, 50).map((l) => (
                <li key={`${l.pran}|${l.month}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>
                    <span className="tabular font-medium">{l.pran}</span> {l.name ? `· ${l.name}` : ""} · {formatMonth(l.month, locale)}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-ink-600">
                    {l.ours && `${t("statutory.nps.ours")} ${formatINR(l.ours.employee + l.ours.employer)}`}
                    {l.cra && ` · ${t("statutory.nps.cra")} ${formatINR(l.cra.employee + l.cra.employer)}`}
                    <Badge tone={TONE[l.status]}>{t(`statutory.nps.status.${l.status}`)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
