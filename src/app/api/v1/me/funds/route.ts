import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { myFunds } from "@/modules/statutory/my-funds";

/** S-50 (own): my GPF account or my NPS contributions. */
export const GET = apiRoute(async ({ actor, query }) => myFunds(actor, query(z.object({ fy: z.string().optional() })).fy));
