"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { makeT, type TFunction } from "./index";
import type { Locale } from "./types";

const I18nContext = createContext<{ locale: Locale; t: TFunction } | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(locale) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

export function useT(): TFunction {
  return useI18n().t;
}

/** Switches language: stores the cookie (and the user's preference when signed in) and reloads data. */
export function useSetLocale() {
  return useCallback(async (locale: Locale) => {
    await fetch("/api/v1/preferences/language", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: locale }),
    });
    window.location.reload();
  }, []);
}
