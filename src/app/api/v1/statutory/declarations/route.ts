import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { listDeclarations } from "@/modules/statutory/tax";

/** S-51: everyone's regime and declaration for a year. */
export const GET = apiRoute(async ({ actor, query }) => listDeclarations(actor, query(z.object({ fy: z.string().optional(), status: z.string().optional() }))));
