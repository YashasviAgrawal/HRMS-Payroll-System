import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { form16Year } from "@/modules/statutory/form16";

/** S-53: everyone paid in a year with the state of their Form 16. */
export const GET = apiRoute(async ({ actor, query }) => form16Year(actor, query(z.object({ fy: z.string().optional() })).fy));
