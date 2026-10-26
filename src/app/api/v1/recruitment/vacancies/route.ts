import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { createVacancy, listVacancies } from "@/modules/recruitment/service";

export const GET = apiRoute(async ({ actor }) => listVacancies(actor));
export const POST = apiRoute(async ({ actor, body }) => {
  const v = await createVacancy(actor, await body(z.unknown()));
  return { id: v.id, referenceNo: v.referenceNo };
});
