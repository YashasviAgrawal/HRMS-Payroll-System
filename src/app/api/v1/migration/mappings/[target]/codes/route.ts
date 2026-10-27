import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { codeValues, parseTarget } from "@/modules/migration/mapping";

/** The old values a code-list field holds, to give each its value here. */
export const GET = apiRoute<{ target: string }>(async ({ actor, params, query }) => {
  const q = query(z.object({ field: z.string().min(1), column: z.string().min(1), fileId: z.string().min(1) }));
  return { values: await codeValues(actor, parseTarget(params.target), q.field, q.column, q.fileId) };
});
