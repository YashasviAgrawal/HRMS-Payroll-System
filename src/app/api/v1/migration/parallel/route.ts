import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { parallelScreen, runParallel } from "@/modules/migration/parallel";

/** §15 step 9: the parallel run, month by month. */
export const GET = apiRoute(async ({ actor, query }) => parallelScreen(actor, query(z.object({ month: z.string().optional() })).month));

export const POST = apiRoute(async ({ actor, body }) => runParallel(actor, await body(z.unknown())));
