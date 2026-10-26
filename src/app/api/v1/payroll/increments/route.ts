import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { incrementDueList, submitIncrements } from "@/modules/payroll/increments";

export const GET = apiRoute(async ({ actor, query }) => incrementDueList(actor, query(z.object({ date: z.string().optional() })).date));

export const POST = apiRoute(async ({ actor, body }) => {
  const task = await submitIncrements(actor, await body(z.unknown()));
  return { taskId: task.id };
});
