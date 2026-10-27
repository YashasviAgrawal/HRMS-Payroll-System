import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { issuesScreen } from "@/modules/migration/console";
import { parseTarget } from "@/modules/migration/mapping";

/** §15 steps 5–6: flagged rows of one target. */
export const GET = apiRoute<{ target: string }>(async ({ actor, params, query }) => {
  const { filter } = query(z.object({ filter: z.enum(["open", "explained", "all"]).optional() }));
  return issuesScreen(actor, parseTarget(params.target), filter);
});
