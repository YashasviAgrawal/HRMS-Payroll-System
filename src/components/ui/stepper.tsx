import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Stages of a process (the payroll's five stages). `current` is the index of the stage in progress; stages
 * before it are done. Pass `current = steps.length` when everything is done. Below the large breakpoint, and always
 * when `compact` (narrow cards), only the circles show with the current stage's name under them — never sideways scroll.
 */
export function Stepper({ steps, current, className, label, compact }: { steps: string[]; current: number; className?: string; label: string; compact?: boolean }) {
  return (
    <nav aria-label={label} className={className}>
      <ol className="flex items-center">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s} className={cn("flex min-w-0 items-center", i < steps.length - 1 && "flex-1")} aria-current={active ? "step" : undefined}>
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold",
                    done && "border-brand-600 bg-brand-600 text-white",
                    active && "border-brand-600 bg-white text-brand-700 ring-4 ring-brand-100",
                    !done && !active && "border-ink-200 bg-white text-ink-400",
                  )}
                >
                  {done ? <Check className="size-4" aria-hidden="true" /> : i + 1}
                </span>
                <span className={cn("truncate text-sm font-medium", active ? "text-ink-950" : done ? "text-brand-800" : "text-ink-500", compact ? "sr-only" : "sr-only lg:not-sr-only")}>
                  {s}
                  {done && <span className="sr-only"> ✓</span>}
                </span>
              </div>
              {i < steps.length - 1 && <span className={cn("mx-2 h-0.5 min-w-3 flex-1 rounded-full sm:mx-3", done ? "bg-brand-500" : "bg-ink-200")} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
      {current < steps.length && (
        <p className={cn("mt-2 text-xs font-medium text-ink-600", !compact && "lg:hidden")} aria-hidden="true">
          {steps[current]}
        </p>
      )}
    </nav>
  );
}
