import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { payrollOverview, runPayroll } from "@/modules/payroll/run";

export const GET = apiRoute(async ({ actor, query }) => payrollOverview(actor, query(z.object({ month: z.string().optional() })).month));

export const POST = apiRoute(async ({ actor, body }) => {
  const run = await runPayroll(actor, await body(z.unknown()));
  return { id: run.id, version: run.version };
});
