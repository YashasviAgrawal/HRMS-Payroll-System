import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { proposeSanctioned, sanctionedOverview } from "@/modules/employees/records";

export const GET = apiRoute(async ({ actor }) => sanctionedOverview(actor));
export const POST = apiRoute(async ({ actor, body }) => {
  const task = await proposeSanctioned(actor, await body(z.unknown()));
  return { taskId: task.id };
});
