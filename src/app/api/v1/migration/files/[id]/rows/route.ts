import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { tableRows } from "@/modules/migration/staging";

export const GET = apiRoute<{ id: string }>(async ({ actor, params, query }) => {
  const q = query(z.object({ page: z.coerce.number().int().min(1).optional(), deleted: z.enum(["1", "0"]).optional() }));
  return tableRows(actor, params.id, { page: q.page, deleted: q.deleted === "1" });
});
