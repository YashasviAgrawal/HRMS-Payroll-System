import { cn } from "@/lib/utils";

export type Tone = "green" | "gray" | "amber" | "red" | "blue" | "gold" | "violet";

const tones: Record<Tone, string> = {
  green: "bg-brand-50 text-brand-800 ring-brand-600/15",
  gray: "bg-ink-100 text-ink-700 ring-ink-500/15",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/15",
  blue: "bg-sky-50 text-sky-800 ring-sky-600/15",
  gold: "bg-gold-50 text-gold-600 ring-gold-500/25",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/15",
};

const dots: Record<Tone, string> = {
  green: "bg-brand-500",
  gray: "bg-ink-400",
  amber: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-sky-500",
  gold: "bg-gold-500",
  violet: "bg-violet-500",
};

export function Badge({ tone = "gray", dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>
      {dot && <span className={cn("size-1.5 rounded-full", dots[tone])} aria-hidden="true" />}
      {children}
    </span>
  );
}
