import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { checkRun } from "@/modules/payroll/run";

export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  await checkRun(actor, params.id, await body(z.unknown()));
  return { ok: true };
});
