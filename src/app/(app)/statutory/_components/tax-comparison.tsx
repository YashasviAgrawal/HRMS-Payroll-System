"use client";

import { CircleCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/client";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Regime, TaxWorking } from "@/modules/statutory/tax-rules";

/** ST-02: the year's tax worked out both ways, side by side, with the lower one marked. */
export function TaxComparison({ workings, chosen, monthsLeft, deducted }: { workings: Record<Regime, TaxWorking>; chosen: Regime; monthsLeft?: number; deducted?: number }) {
  const { t } = useI18n();
  const lower: Regime = workings.OLD.total < workings.NEW.total ? "OLD" : "NEW";
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {(["NEW", "OLD"] as Regime[]).map((r) => {
        const w = workings[r];
        const via = w.chapterVIA.sec80C + w.chapterVIA.sec80D + w.chapterVIA.sec80CCD1B + w.chapterVIA.homeLoanInterest;
        const rows: [string, number][] = [
          [t("statutory.tax.line.gross"), w.gross + w.otherIncome],
          [t("statutory.tax.line.standardDeduction"), -w.standardDeduction],
          ...(w.hraExempt ? ([[t("statutory.tax.line.hraExempt"), -w.hraExempt]] as [string, number][]) : []),
          ...(w.employerNps ? ([[t("statutory.tax.line.employerNps"), -w.employerNps]] as [string, number][]) : []),
          ...(via ? ([[t("statutory.tax.line.chapterVIA"), -via]] as [string, number][]) : []),
          [t("statutory.tax.line.taxable"), w.taxable],
          ...(w.rebate ? ([[t("statutory.tax.line.rebate"), -w.rebate]] as [string, number][]) : []),
        ];
        const left = monthsLeft && monthsLeft > 0 ? Math.max(0, Math.round((w.total - (deducted ?? 0)) / monthsLeft)) : null;
        return (
          <div key={r} data-testid={`regime-${r}`} className={cn("rounded-2xl border p-4", r === chosen ? "border-brand-300 bg-brand-50/40" : "border-ink-200")}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <p className="font-semibold text-ink-900">{t(`statutory.tax.regimes.${r}`)}</p>
              {r === chosen && (
                <Badge tone="green">
                  <CircleCheck className="size-3" aria-hidden="true" />
                  {t("statutory.tax.chosen")}
                </Badge>
              )}
              {r === lower && workings.OLD.total !== workings.NEW.total && <Badge tone="blue">{t("statutory.tax.lower")}</Badge>}
            </div>
            <dl className="space-y-1 text-sm">
              {rows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-ink-600">{label}</dt>
                  <dd className="tabular text-ink-900">{value < 0 ? `− ${formatINR(-value)}` : formatINR(value)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-ink-200 pt-2">
                <dt className="font-medium text-ink-900">{t("statutory.tax.line.total")}</dt>
                <dd className="tabular text-lg font-semibold text-ink-950">{formatINR(w.total)}</dd>
              </div>
            </dl>
            {left !== null && <p className="mt-2 text-xs text-ink-500">{t("statutory.tax.line.monthly", { amount: formatINR(left) })}</p>}
          </div>
        );
      })}
    </div>
  );
}
