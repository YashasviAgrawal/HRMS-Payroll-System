export type Locale = "en" | "hi";
export const LOCALES: Locale[] = ["en", "hi"];
export const LOCALE_COOKIE = "dcb_lang";

/** Same shape as the English dictionary, but every leaf may hold any string. */
export type DeepStrings<T> = { [K in keyof T]: T[K] extends string ? string : DeepStrings<T[K]> };

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
/** "login.title" | "common.save" | … — every leaf path of a dictionary. */
export type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : Join<K, Paths<T[K]>>;
}[keyof T & string];

export type Vars = Record<string, string | number>;

export function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else return undefined;
  }
  return typeof node === "string" ? node : undefined;
}

export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}
