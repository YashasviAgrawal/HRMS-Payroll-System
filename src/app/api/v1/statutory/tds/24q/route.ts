import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { make24q } from "@/modules/statutory/tds";

/** ST-06: the quarter's Form 24Q, sent to an Admin to release. */
export const POST = apiRoute(async ({ actor, body }) => {
  const { fy, quarter } = await body(z.object({ fy: z.string(), quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) }));
  const file = await make24q(actor, fy, quarter);
  return { id: file.id };
});
