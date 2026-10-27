import { cn } from "@/lib/utils";
import { ScrollArea } from "./scroll-area";

/**
 * Data table. Keyboard-first (PRD §16): a row that opens something carries a link in its first cell (Tab, Enter).
 * Wide tables scroll inside their card, never the whole page.
 */
export function Table({ className, children, stack }: { className?: string; children: React.ReactNode; stack?: boolean }) {
  return (
    <ScrollArea className={cn(stack && "stack-table", className)}>
      <table className="w-full border-separate border-spacing-0 text-left text-sm">{children}</table>
    </ScrollArea>
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

/** In a `stack` table, `label` names the value on phones and `actions` marks the buttons cell. */
export function Td({
  className,
  children,
  align = "left",
  label,
  actions,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center"; label?: string; actions?: boolean }) {
  return (
    <td
      data-label={label}
      data-actions={actions ? "" : undefined}
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
        interactive && "cursor-pointer hover:bg-brand-50/40 focus-within:bg-brand-50/60",
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}
