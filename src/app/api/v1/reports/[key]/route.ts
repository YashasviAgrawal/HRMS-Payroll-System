import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { runReport } from "@/modules/reports/registry";

const filters = z.object({ month: z.string().optional(), section: z.string().optional(), type: z.string().optional() });

/** S-70: one report's columns, rows and note for the filters (month, section, employee type). */
export const GET = apiRoute<{ key: string }>(async ({ actor, params, query }) => {
  const ran = await runReport(actor, params.key, query(filters));
  return { no: ran.def.no, key: ran.def.key, filters: ran.filters, lockedSectionId: ran.lockedSectionId, ...ran.result };
});
