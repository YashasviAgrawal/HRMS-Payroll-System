import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-sm text-ink-500">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {b.href ? (
                  <Link href={b.href} className="hover:text-brand-700">
                    {b.label}
                  </Link>
                ) : (
                  <span className="text-ink-700">{b.label}</span>
                )}
                {i < breadcrumbs.length - 1 && <ChevronRight className="size-3.5 text-ink-300" aria-hidden="true" />}
              </span>
            ))}
          </nav>
        )}
        {title && <h1 className="text-2xl font-semibold tracking-tight text-ink-950 sm:text-[1.65rem]">{title}</h1>}
        {description && <p className="mt-1.5 max-w-3xl text-[0.9375rem] text-ink-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
