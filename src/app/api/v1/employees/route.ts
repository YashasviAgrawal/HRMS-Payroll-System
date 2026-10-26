import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { createEmployee, listEmployees } from "@/modules/employees/service";

const listQuery = z.object({
  q: z.string().max(80).optional(),
  sectionId: z.string().max(40).optional(),
  type: z.string().max(30).optional(),
  payLevel: z.string().max(4).optional(),
  status: z.string().max(20).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = apiRoute(async ({ actor, query }) => listEmployees(actor, query(listQuery)));
export const POST = apiRoute(async ({ actor, body }) => {
  const e = await createEmployee(actor, await body(z.unknown()));
  return { id: e.id };
});
