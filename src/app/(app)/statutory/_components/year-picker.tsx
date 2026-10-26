import Link from "next/link";
import { cn } from "@/lib/utils";

/** Financial years (or months) as links — the choice lives in the URL so it can be bookmarked. */
export function PeriodPicker({ options, active, href, label, format = (v) => v }: { options: string[]; active: string; href: (v: string) => string; label: string; format?: (v: string) => string }) {
  if (options.length < 2) return null;
  return (
    <div className="scrollbar-thin -mx-1 mb-4 overflow-x-auto px-1">
      <div className="flex min-w-max items-center gap-1 rounded-xl bg-ink-100 p-1" role="group" aria-label={label}>
        {options.map((o) => (
          <Link key={o} href={href(o)} aria-current={o === active ? "page" : undefined} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold tabular", o === active ? "bg-white text-brand-800 shadow-card" : "text-ink-600 hover:text-ink-900")}>
            {format(o)}
          </Link>
        ))}
      </div>
    </div>
  );
}
