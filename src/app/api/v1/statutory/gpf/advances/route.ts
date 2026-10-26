import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { sanctionGpfAdvance } from "@/modules/statutory/gpf";

/** §9 GPF: an advance or withdrawal sent to a Checker, then an Admin. */
export const POST = apiRoute(async ({ actor, body }) => {
  const a = await sanctionGpfAdvance(actor, await body(z.unknown()));
  return { id: a.id };
});
