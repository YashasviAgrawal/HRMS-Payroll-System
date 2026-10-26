import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { addApplicant } from "@/modules/recruitment/service";

export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  const a = await addApplicant(actor, params.id, await body(z.unknown()));
  return { id: a.id, applicationNo: a.applicationNo };
});
