import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { makeT } from "./index";
import { LOCALE_COOKIE, type Locale } from "./types";

/** The language chosen on the login screen or in My profile, remembered in a cookie. */
export const getLocale = cache(async (): Promise<Locale> => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return value === "hi" ? "hi" : "en";
});

export async function getT() {
  const locale = await getLocale();
  return { t: makeT(locale), locale };
}
