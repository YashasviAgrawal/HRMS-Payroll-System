import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { proposeTaxRule, taxRulesScreen } from "@/modules/statutory/rules";

/** ST-01: income-tax slabs by year and regime; a change goes to an Admin. */
export const GET = apiRoute(async ({ actor }) => taxRulesScreen(actor));

export const POST = apiRoute(async ({ actor, body }) => {
  const task = await proposeTaxRule(actor, await body(z.unknown()));
  return { id: task.id };
});
