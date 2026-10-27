import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { submitCase } from "@/modules/pension/cases";

/** PN-09: send the case to a Checker. */
export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  const { note } = await body(z.object({ note: z.string().trim().max(300).optional() }));
  return submitCase(actor, params.id, note);
});
