import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { explainDiff } from "@/modules/migration/parallel";

export const PUT = apiRoute<{ id: string }>(async ({ actor, params, body }) => explainDiff(actor, params.id, await body(z.unknown())));
