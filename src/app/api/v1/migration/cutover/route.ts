import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { cutOverScreen, proposeCutOver } from "@/modules/migration/cutover";

/** §15 step 10: readiness, and the request for the Admin's sign-off. */
export const GET = apiRoute(async ({ actor }) => cutOverScreen(actor));

export const POST = apiRoute(async ({ actor, body }) => {
  const task = await proposeCutOver(actor, await body(z.unknown()));
  return { taskId: task.id };
});
