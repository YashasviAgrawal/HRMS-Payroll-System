import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { updateChecklist } from "@/modules/recruitment/service";

export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => updateChecklist(actor, params.id, await body(z.unknown())));
