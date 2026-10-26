import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { clearResolution, resolveException } from "@/modules/payroll/run";

export const POST = apiRoute<{ id: string; exceptionId: string }>(async ({ actor, params, body }) => {
  await resolveException(actor, params.id, params.exceptionId, await body(z.unknown()));
  return { ok: true };
});

export const DELETE = apiRoute<{ id: string; exceptionId: string }>(async ({ actor, params }) => {
  await clearResolution(actor, params.id, params.exceptionId);
  return { ok: true };
});
