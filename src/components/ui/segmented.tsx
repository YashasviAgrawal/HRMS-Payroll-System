"use client";

import { cn } from "@/lib/utils";

/** Segmented control — a small set of mutually exclusive choices shown side by side. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = "md",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; icon?: React.ReactNode }[];
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-1 rounded-xl bg-ink-100 p-1", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg px-2 text-center font-medium transition-all",
              size === "sm" ? "h-8 text-xs" : "min-h-10 py-1.5 text-sm",
              active ? "bg-white text-brand-800 shadow-card ring-1 ring-ink-200/70" : "text-ink-600 hover:text-ink-900",
            )}
          >
            {o.icon}
            <span className="leading-tight">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
