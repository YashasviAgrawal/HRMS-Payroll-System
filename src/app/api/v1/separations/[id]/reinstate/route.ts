import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { proposeReinstatement } from "@/modules/employees/separation";

/** HR asks to reinstate a suspended employee (Checker, then Admin). */
export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  const task = await proposeReinstatement(actor, params.id, await body(z.unknown()));
  return { taskId: task.id };
});
