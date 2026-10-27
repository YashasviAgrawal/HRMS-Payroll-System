"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A box that scrolls sideways inside its card. When it really is wider than the screen it joins the
 * Tab order, so keyboard users can scroll it with the arrow keys (WCAG 2.1.1).
 */
export function ScrollArea({ className, label, children }: { className?: string; label?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn("scrollbar-thin relative overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600", className)}
      tabIndex={overflows ? 0 : undefined}
      role={overflows && label ? "region" : undefined}
      aria-label={overflows && label ? label : undefined}
    >
      {children}
    </div>
  );
}
