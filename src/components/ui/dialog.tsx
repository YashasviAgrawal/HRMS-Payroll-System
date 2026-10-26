"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Modal built on the native <dialog> element: focus is trapped, Esc closes, and the page behind is inert.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeLabel = "Close",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  closeLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const widths = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-2xl border border-ink-200 bg-white p-0 text-ink-900 shadow-overlay open:animate-slide-up",
        widths[size],
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-6 py-4">
            <div>
              <h2 className="text-base font-semibold text-ink-950">{title}</h2>
              {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              aria-label={closeLabel}
            >
              <X className="size-5" />
            </button>
          </div>
          {children && <div className="scrollbar-thin overflow-y-auto px-6 py-5">{children}</div>}
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 bg-ink-50/50 px-6 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
