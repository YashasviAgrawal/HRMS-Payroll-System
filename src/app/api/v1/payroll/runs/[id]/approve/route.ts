import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { approveRun } from "@/modules/payroll/run";

export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  await approveRun(actor, params.id, await body(z.unknown()));
  return { ok: true };
});
