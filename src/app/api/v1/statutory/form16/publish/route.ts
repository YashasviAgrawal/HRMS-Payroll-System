import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { proposePublish } from "@/modules/statutory/form16";

/** ST-07, ST-09: publishing a year's Form 16 goes to an Admin. */
export const POST = apiRoute(async ({ actor, body }) => {
  const task = await proposePublish(actor, (await body(z.object({ fy: z.string() }))).fy);
  return { id: task.id };
});
