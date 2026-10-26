"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/** Six boxes for the OTP. Paste fills all boxes; the phone's SMS auto-fill works via one-time-code. */
export function OtpInput({
  value,
  onChange,
  length = 6,
  invalid,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  invalid?: boolean;
  label: string;
  autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  function set(index: number, digit: string) {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join("").slice(0, length));
  }

  return (
    <div className="flex justify-between gap-2" role="group" aria-label={label}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          autoFocus={autoFocus && i === 0}
          aria-label={`${label} ${i + 1}`}
          maxLength={length}
          className={cn(
            "tabular size-12 rounded-xl border bg-white text-center text-xl font-semibold text-ink-950 shadow-[inset_0_1px_1px_rgb(15_32_24/0.04)] transition-colors focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/12 sm:size-13",
            invalid ? "border-red-400" : "border-ink-200",
          )}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, "");
            if (raw.length > 1) {
              // Paste or SMS auto-fill: spread across boxes.
              onChange((digits.slice(0, i).join("") + raw).slice(0, length));
              refs.current[Math.min(i + raw.length, length - 1)]?.focus();
              return;
            }
            set(i, raw);
            if (raw && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
