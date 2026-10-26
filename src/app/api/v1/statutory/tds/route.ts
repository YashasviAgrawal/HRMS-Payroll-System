import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { tdsYear } from "@/modules/statutory/tds";

/** ST-05, ST-06: TDS deducted and deposited month by month, and each quarter's 24Q. */
export const GET = apiRoute(async ({ actor, query }) => tdsYear(actor, query(z.object({ fy: z.string().optional() })).fy));
