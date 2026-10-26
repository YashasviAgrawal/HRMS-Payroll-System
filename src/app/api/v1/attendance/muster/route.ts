import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { submitMuster } from "@/modules/attendance/service";

export const POST = apiRoute(async ({ actor, body }) => {
  const task = await submitMuster(actor, await body(z.unknown()));
  return { taskId: task.id };
});
