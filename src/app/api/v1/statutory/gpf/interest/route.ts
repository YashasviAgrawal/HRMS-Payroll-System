import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { gpfInterestSummary, proposeGpfInterest } from "@/modules/statutory/gpf";

/** §9 GPF: the year's interest for every account, and sending it to an Admin once the year is over. */
export const GET = apiRoute(async ({ actor, query }) => gpfInterestSummary(actor, query(z.object({ fy: z.string() })).fy));

export const POST = apiRoute(async ({ actor, body }) => {
  const task = await proposeGpfInterest(actor, (await body(z.object({ fy: z.string() }))).fy);
  return { id: task.id };
});
