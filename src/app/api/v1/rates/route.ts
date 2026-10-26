import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { proposeRate, rulesOverview } from "@/modules/payroll/rates";

export const GET = apiRoute(async ({ actor }) => rulesOverview(actor));

export const POST = apiRoute(async ({ actor, body }) => {
  const task = await proposeRate(actor, await body(z.unknown()));
  return { taskId: task.id };
});
