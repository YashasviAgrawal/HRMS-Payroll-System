import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { reopenRun } from "@/modules/payroll/run";

export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  await reopenRun(actor, params.id, await body(z.unknown()));
  return { ok: true };
});
