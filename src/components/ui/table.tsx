import { cn } from "@/lib/utils";

/**
 * Data table. Keyboard-first (PRD §16): rows that open something are focusable and respond to Enter.
 * Wide tables scroll inside their card, never the whole page.
 */
export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("scrollbar-thin overflow-x-auto", className)}>
      <table className="w-full border-separate border-spacing-0 text-left text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="sticky top-0 z-[1] bg-ink-50/95 backdrop-blur">{children}</thead>;
}

export function Th({ className, children, align = "left", ...rest }: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap border-b border-ink-200 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-500 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({ className, children, align = "left", ...rest }: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return (
    <td
      className={cn(
        "border-b border-ink-100 px-4 py-3 align-middle text-ink-800 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6",
        align === "right" && "tabular text-right",
        align === "center" && "text-center",
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}

export function Tr({ className, children, interactive, ...rest }: React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(
        "transition-colors last:[&>td]:border-b-0",
        interactive && "cursor-pointer hover:bg-brand-50/40 focus-visible:bg-brand-50/60 focus-visible:outline-none",
        className,
      )}
      tabIndex={interactive ? 0 : undefined}
      {...rest}
    >
      {children}
    </tr>
  );
}
