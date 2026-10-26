import { apiRoute } from "@/lib/api/route";
import { IDLE_TIMEOUT_MS } from "@/lib/auth/session";

/** Keep-alive used by the idle timer: any authenticated call moves "last seen" forward. */
export const GET = apiRoute(async ({ actor }) => ({
  userId: actor.userId,
  name: actor.name,
  loginType: actor.loginType,
  idleTimeoutSeconds: IDLE_TIMEOUT_MS / 1000,
}));
