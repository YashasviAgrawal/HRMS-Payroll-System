import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { proposeSeparation } from "@/modules/employees/separation";

/** HR records a suspension or the person leaving service (Checker, then Admin). */
export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  const sep = await proposeSeparation(actor, params.id, await body(z.unknown()));
  return { id: sep.id };
});
