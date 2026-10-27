import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { mappingScreen, parseTarget, saveMapping } from "@/modules/migration/mapping";

/** §15 step 4: one target's mapping sheet. */
export const GET = apiRoute<{ target: string }>(async ({ actor, params, query }) => mappingScreen(actor, parseTarget(params.target), query(z.object({ file: z.string().optional() })).file));

export const PUT = apiRoute<{ target: string }>(async ({ actor, params, body }) => {
  const m = await saveMapping(actor, parseTarget(params.target), await body(z.unknown()));
  return { id: m.id };
});
