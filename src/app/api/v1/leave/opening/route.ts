import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { submitOpening } from "@/modules/leave/opening";

export const POST = apiRoute(async ({ actor, body }) => {
  const task = await submitOpening(actor, await body(z.unknown()));
  return { taskId: task.id };
});
