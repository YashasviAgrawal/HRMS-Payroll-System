import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { pensionOverview } from "@/modules/pension/overview";

/** S-61: the month's pension bill, supplementary pension bills and what needs doing. */
export const GET = apiRoute(async ({ actor, query }) => pensionOverview(actor, query(z.object({ month: z.string().optional() })).month));
