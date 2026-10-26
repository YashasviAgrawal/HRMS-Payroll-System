"use client";

import { Languages } from "lucide-react";
import { useState } from "react";
import { useI18n, useSetLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** EN / हिं switch, available on every screen including sign-in (PRD §16, S-01). */
export function LanguageSwitch({ className, tone = "light", compact }: { className?: string; tone?: "light" | "dark"; compact?: boolean }) {
  const { locale, t } = useI18n();
  const setLocale = useSetLocale();
  const [busy, setBusy] = useState(false);
  return (
    <div
      role="group"
      aria-label={t("common.language")}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full p-0.5 text-xs font-semibold",
        tone === "dark" ? "bg-white/10 text-white ring-1 ring-white/20" : "bg-ink-100 text-ink-600",
        className,
      )}
    >
      <Languages className={cn("mx-1.5 size-3.5 opacity-70", compact && "hidden sm:block")} aria-hidden="true" />
      {(["en", "hi"] as const).map((l) => (
        <button
          key={l}
          type="button"
          disabled={busy}
          aria-pressed={locale === l}
          onClick={async () => {
            if (l === locale) return;
            setBusy(true);
            await setLocale(l);
          }}
          className={cn(
            "rounded-full py-1 transition-colors",
            compact ? "px-2 sm:px-2.5" : "px-2.5",
            locale === l
              ? tone === "dark"
                ? "bg-white text-brand-800"
                : "bg-white text-brand-800 shadow-card"
              : tone === "dark"
                ? "hover:bg-white/10"
                : "hover:text-ink-900",
          )}
        >
          {l === "en" ? "EN" : "हिं"}
        </button>
      ))}
    </div>
  );
}
