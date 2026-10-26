import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { dueRulesScreen, proposeDueRule } from "@/modules/statutory/rules";

/** ST-01, ST-08: statutory due dates; a change goes to an Admin. */
export const GET = apiRoute(async ({ actor }) => dueRulesScreen(actor));

export const POST = apiRoute(async ({ actor, body }) => {
  const task = await proposeDueRule(actor, await body(z.unknown()));
  return { id: task.id };
});
