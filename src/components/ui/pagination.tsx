import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Server-friendly pager: builds links that keep the other query parameters. */
export function Pagination({
  page,
  pageSize,
  total,
  baseHref,
  params,
  labels,
}: {
  page: number;
  pageSize: number;
  total: number;
  baseHref: string;
  params: Record<string, string | undefined>;
  labels: { showing: string; previous: string; next: string };
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set("page", String(p));
    return `${baseHref}?${q.toString()}`;
  };
  const linkCls = "inline-flex h-8 items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 text-sm text-ink-700 hover:bg-ink-50";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-5 py-3 text-sm text-ink-500 sm:px-6">
      <span>{labels.showing}</span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={linkCls}>
            <ChevronLeft className="size-4" /> {labels.previous}
          </Link>
        ) : (
          <span className={cn(linkCls, "pointer-events-none opacity-50")}>
            <ChevronLeft className="size-4" /> {labels.previous}
          </span>
        )}
        {page < pages ? (
          <Link href={href(page + 1)} className={linkCls}>
            {labels.next} <ChevronRight className="size-4" />
          </Link>
        ) : (
          <span className={cn(linkCls, "pointer-events-none opacity-50")}>
            {labels.next} <ChevronRight className="size-4" />
          </span>
        )}
      </div>
    </div>
  );
}
