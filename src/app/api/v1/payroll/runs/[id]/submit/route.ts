import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { submitRun } from "@/modules/payroll/run";

export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  await submitRun(actor, params.id, await body(z.unknown()));
  return { ok: true };
});
