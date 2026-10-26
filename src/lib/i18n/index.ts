import { en } from "./en";
import { hi } from "./hi";
import { interpolate, lookup, type Locale, type Paths, type Vars } from "./types";

export type Dictionary = typeof en;
export type TKey = Paths<Dictionary>;
export type TFunction = (key: TKey, vars?: Vars) => string;

export const dictionaries: Record<Locale, Dictionary> = { en, hi: hi as unknown as Dictionary };

/** Builds a translator. Missing Hindi text falls back to English, never to a raw key. */
export function makeT(locale: Locale): TFunction {
  const dict = dictionaries[locale];
  return (key, vars) => interpolate(lookup(dict, key) ?? lookup(en, key) ?? key, vars);
}

/** For dynamic keys such as `permission.${p}` — still falls back safely. */
export function tDynamic(t: TFunction, key: string, vars?: Vars): string {
  return t(key as TKey, vars);
}

export type { Locale } from "./types";
