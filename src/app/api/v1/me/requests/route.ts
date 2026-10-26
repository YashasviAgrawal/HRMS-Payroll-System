import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { myRequests, submitSelfRequest } from "@/modules/employees/records";

export const GET = apiRoute(async ({ actor }) => myRequests(actor));
export const POST = apiRoute(async ({ actor, body }) => {
  const task = await submitSelfRequest(actor, await body(z.unknown()));
  return { taskId: task.id };
});
