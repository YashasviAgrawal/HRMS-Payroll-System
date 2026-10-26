import { publicRoute } from "@/lib/api/route";
import { clearSessionCookie } from "@/lib/auth/session";
import { logout } from "@/modules/auth/service";

export const POST = publicRoute(async ({ actor }) => {
  if (actor) await logout(actor);
  await clearSessionCookie();
  return { redirect: "/login?reason=signedout" };
});
