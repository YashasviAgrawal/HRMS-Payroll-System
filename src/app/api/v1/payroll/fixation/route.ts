import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { submitFixation } from "@/modules/payroll/fixation";

export const POST = apiRoute(async ({ actor, body }) => {
  const task = await submitFixation(actor, await body(z.unknown()));
  return { taskId: task.id };
});
