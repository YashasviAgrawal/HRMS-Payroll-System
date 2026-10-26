import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** ‹ 2026 › for the holiday calendar. */
export function YearNav({ year, max }: { year: number; max: number }) {
  const btn = "flex size-9 items-center justify-center rounded-xl border border-ink-200 bg-white text-ink-600 transition-colors hover:border-brand-200 hover:text-brand-700";
  return (
    <div className="flex items-center gap-2">
      <Link href={`/attendance/holidays?year=${year - 1}`} className={btn} aria-label={String(year - 1)}>
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Link>
      <span className="tabular min-w-14 text-center text-sm font-semibold text-ink-900">{year}</span>
      {year < max ? (
        <Link href={`/attendance/holidays?year=${year + 1}`} className={btn} aria-label={String(year + 1)}>
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
