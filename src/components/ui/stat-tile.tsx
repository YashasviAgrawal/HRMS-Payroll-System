import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  hint,
  icon,
  href,
  tone = "green",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  href?: string;
  tone?: "green" | "amber" | "red" | "gray" | "blue";
}) {
  const toneClass = {
    green: "bg-brand-50 text-brand-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    gray: "bg-ink-100 text-ink-600",
    blue: "bg-sky-50 text-sky-700",
  }[tone];
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-600">{label}</p>
        {icon && <span className={cn("flex size-9 items-center justify-center rounded-xl", toneClass)}>{icon}</span>}
      </div>
      <p className="tabular mt-3 text-[1.75rem] font-semibold leading-none tracking-tight text-ink-950">{value}</p>
      {hint && <p className="mt-2 text-xs text-ink-500">{hint}</p>}
      {href && <ArrowUpRight className="absolute bottom-4 right-4 size-4 text-ink-300 transition-colors group-hover:text-brand-600" aria-hidden="true" />}
    </>
  );
  const cls = "group relative block rounded-2xl border border-ink-200/80 bg-white p-5 shadow-card transition-shadow";
  return href ? (
    <Link href={href} className={cn(cls, "hover:border-brand-200 hover:shadow-raised")}>
      {content}
    </Link>
  ) : (
    <div className={cls}>{content}</div>
  );
}
