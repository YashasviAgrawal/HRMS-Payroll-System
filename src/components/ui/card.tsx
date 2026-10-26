import { cn } from "@/lib/utils";

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-2xl border border-ink-200/80 bg-white shadow-card", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4 sm:px-6", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">{icon}</div>}
        <div className="min-w-0">
          <h2 className="text-[0.95rem] font-semibold text-ink-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-5 py-5 sm:px-6", className)}>{children}</div>;
}

export function CardFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-ink-100 bg-ink-50/50 px-5 py-3 sm:px-6", className)}>
      {children}
    </div>
  );
}

/** Label/value pairs, e.g. on a profile tab. */
export function DescriptionList({ items, columns = 2 }: { items: { label: React.ReactNode; value: React.ReactNode }[]; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-8 gap-y-5", columns === 3 ? "sm:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "")}>
      {items.map((item, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{item.label}</dt>
          <dd className="mt-1 break-words text-[0.9375rem] text-ink-900">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
