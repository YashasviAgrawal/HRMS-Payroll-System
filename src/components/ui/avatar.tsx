import { cn, initials } from "@/lib/utils";

export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const sizes = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg" };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-100 to-brand-200 font-semibold text-brand-800 ring-2 ring-white",
        sizes[size],
        className,
      )}
      aria-hidden="true"
    >
      {initials(name) || "?"}
    </span>
  );
}
