import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { proposeCarryIn } from "@/modules/statutory/tax";

/** ST-04: salary and TDS of the year paid outside the system, sent to a Checker. */
export const POST = apiRoute(async ({ actor, body }) => {
  const task = await proposeCarryIn(actor, await body(z.unknown()));
  return { id: task.id };
});
