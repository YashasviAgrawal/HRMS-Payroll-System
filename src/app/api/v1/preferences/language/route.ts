import { cookies } from "next/headers";
import { z } from "zod";
import { publicRoute } from "@/lib/api/route";
import { LOCALE_COOKIE } from "@/lib/i18n/types";
import { setLanguage } from "@/modules/auth/service";

const schema = z.object({ language: z.enum(["en", "hi"]) });

/** Works before sign-in (login screen toggle) and after (also saved on the user, S-03). */
export const POST = publicRoute(async ({ actor, body }) => {
  const { language } = await body(schema);
  (await cookies()).set(LOCALE_COOKIE, language, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  await setLanguage(actor, language);
  return { language };
});
