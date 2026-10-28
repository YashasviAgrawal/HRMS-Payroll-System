import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { listSeparations } from "@/modules/employees/separation";

/** Suspensions and people leaving service; `show=all` includes the finished ones. */
export const GET = apiRoute(async ({ actor, query }) => listSeparations(actor, query(z.object({ show: z.string().optional(), kind: z.string().optional() }))));
