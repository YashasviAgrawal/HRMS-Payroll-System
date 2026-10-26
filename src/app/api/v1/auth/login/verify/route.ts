import { z } from "zod";
import { publicRoute } from "@/lib/api/route";
import { setSessionCookie } from "@/lib/auth/session";
import { otpField } from "@/lib/validators";
import { verifyLogin } from "@/modules/auth/service";
import { cookies } from "next/headers";
import { LOCALE_COOKIE } from "@/lib/i18n/types";

const schema = z.object({ challengeId: z.string().min(10).max(64), otp: otpField });

export const POST = publicRoute(async ({ body, meta }) => {
  const result = await verifyLogin(await body(schema), meta);
  await setSessionCookie(result.token, result.expiresAt);
  // The person's saved language wins over whatever the sign-in page was showing.
  (await cookies()).set(LOCALE_COOKIE, result.language === "hi" ? "hi" : "en", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return { redirect: result.mustChangePassword ? "/profile?setup=1" : "/home" };
});
