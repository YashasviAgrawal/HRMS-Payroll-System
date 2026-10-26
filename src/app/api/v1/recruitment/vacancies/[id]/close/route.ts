import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { closeVacancy } from "@/modules/recruitment/service";

export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  const { cancel } = await body(z.object({ cancel: z.boolean().default(false) }));
  await closeVacancy(actor, params.id, cancel);
  return { ok: true };
});
