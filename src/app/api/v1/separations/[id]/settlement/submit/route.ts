import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { submitSettlement } from "@/modules/payroll/settlement";

/** Sends the statement to a Checker (then an Admin); it is fixed from then on. */
export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  const task = await submitSettlement(actor, params.id, await body(z.unknown()));
  return { taskId: task.id };
});
