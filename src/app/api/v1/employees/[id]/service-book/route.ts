import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { addServiceEntry, listServiceBook } from "@/modules/employees/records";

export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => listServiceBook(actor, params.id));
export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  const entry = await addServiceEntry(actor, params.id, await body(z.unknown()));
  return { id: entry.id };
});
