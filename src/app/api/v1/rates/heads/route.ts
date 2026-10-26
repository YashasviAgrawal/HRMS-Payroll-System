import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { proposeHead } from "@/modules/payroll/rates";

export const POST = apiRoute(async ({ actor, body }) => {
  const task = await proposeHead(actor, await body(z.unknown()));
  return { taskId: task.id };
});
