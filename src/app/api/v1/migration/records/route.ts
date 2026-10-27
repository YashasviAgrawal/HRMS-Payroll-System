import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { verificationList } from "@/modules/migration/verify";

/** §15 step 7: records compared, confirmed and locked. */
export const GET = apiRoute(async ({ actor, query }) => {
  const q = query(z.object({ kind: z.enum(["staff", "pensioners"]).default("staff"), q: z.string().optional(), state: z.string().optional() }));
  return verificationList(actor, q.kind, { q: q.q, state: q.state });
});
