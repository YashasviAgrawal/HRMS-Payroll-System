import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { employeePayItems, proposePayItem } from "@/modules/payroll/rates";

export const GET = apiRoute(async ({ actor, query }) => employeePayItems(actor, query(z.object({ employeeId: z.string().min(1) })).employeeId));

export const POST = apiRoute(async ({ actor, body }) => {
  const task = await proposePayItem(actor, await body(z.unknown()));
  return { taskId: task.id };
});
