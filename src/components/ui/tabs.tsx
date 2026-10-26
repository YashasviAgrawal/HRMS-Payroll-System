import Link from "next/link";
import { cn } from "@/lib/utils";

/** URL-driven tabs (?tab=…) so a tab can be bookmarked and the back button works. */
export function LinkTabs({
  tabs,
  active,
  className,
}: {
  tabs: { key: string; label: React.ReactNode; href: string; count?: number }[];
  active: string;
  className?: string;
}) {
  return (
    <div className={cn("scrollbar-thin -mx-1 overflow-x-auto", className)}>
      <nav className="flex min-w-max gap-1 border-b border-ink-200 px-1" aria-label="Tabs">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                isActive ? "border-brand-600 text-brand-800" : "border-transparent text-ink-500 hover:border-ink-300 hover:text-ink-800",
              )}
            >
              {t.label}
              {t.count !== undefined && (
                <span className={cn("rounded-full px-1.5 py-px text-xs tabular", isActive ? "bg-brand-100 text-brand-800" : "bg-ink-100 text-ink-600")}>
                  {t.count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
