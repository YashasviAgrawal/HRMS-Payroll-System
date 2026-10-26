"use client";

import { CheckCircle2, AlertTriangle, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info" | "warning";
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const remove = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (message: string, tone: ToastTone = "success") => {
      const id = Date.now() + Math.random();
      setItems((all) => [...all.slice(-3), { id, tone, message }]);
      setTimeout(() => remove(id), tone === "error" ? 7000 : 4000);
    },
    [remove],
  );
  const icons = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
  const colors = { success: "text-brand-600", error: "text-red-600", info: "text-sky-600", warning: "text-amber-600" };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-auto sm:left-auto sm:right-4 sm:top-4 sm:items-end">
        {items.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 shadow-raised"
            >
              <Icon className={cn("mt-0.5 size-5 shrink-0", colors[t.tone])} aria-hidden="true" />
              <p className="flex-1 text-sm text-ink-800">{t.message}</p>
              <button type="button" onClick={() => remove(t.id)} className="text-ink-400 hover:text-ink-700" aria-label="Dismiss">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
