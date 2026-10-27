import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { fixCell } from "@/modules/migration/mapping";

/** §15 step 5: a staged value cleaned (the original is kept). */
export const PUT = apiRoute<{ id: string }>(async ({ actor, params, body }) => fixCell(actor, params.id, await body(z.unknown())));
