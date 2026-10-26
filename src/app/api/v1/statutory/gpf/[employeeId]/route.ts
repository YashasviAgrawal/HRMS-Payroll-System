import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { gpfAccount } from "@/modules/statutory/gpf";

/** One GPF account for a year. */
export const GET = apiRoute<{ employeeId: string }>(async ({ actor, params, query }) => gpfAccount(actor, params.employeeId, query(z.object({ fy: z.string().optional() })).fy));
