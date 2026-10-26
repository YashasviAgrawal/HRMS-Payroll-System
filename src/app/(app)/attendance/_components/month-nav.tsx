import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMonth, shiftMonth } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** "‹ October 2026 ›" — previous / next month links that keep the other query values. */
export function MonthNav({
  month,
  hrefFor,
  maxMonth,
  locale,
  labels,
  className,
}: {
  month: string;
  hrefFor: (month: string) => string;
  maxMonth?: string;
  locale: "en" | "hi";
  labels: { prev: string; next: string };
  className?: string;
}) {
  const next = shiftMonth(month, 1);
  const canNext = !maxMonth || next <= maxMonth;
  const btn = "flex size-9 items-center justify-center rounded-xl border border-ink-200 bg-white text-ink-600 transition-colors hover:border-brand-200 hover:text-brand-700";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Link href={hrefFor(shiftMonth(month, -1))} className={btn} aria-label={labels.prev}>
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Link>
      <p className="min-w-36 text-center text-sm font-semibold text-ink-900">{formatMonth(month, locale)}</p>
      {canNext ? (
        <Link href={hrefFor(next)} className={btn} aria-label={labels.next}>
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      ) : (
        <span className={cn(btn, "pointer-events-none opacity-40")} aria-hidden="true">
          <ChevronRight className="size-4" />
        </span>
      )}
    </div>
  );
}
