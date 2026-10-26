import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { updateApplicant } from "@/modules/recruitment/service";

export const PATCH = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  const a = await updateApplicant(actor, params.id, await body(z.unknown()));
  return { id: a.id, status: a.status };
});
