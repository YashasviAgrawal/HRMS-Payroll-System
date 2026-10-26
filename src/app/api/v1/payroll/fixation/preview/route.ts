import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { previewFixation } from "@/modules/payroll/fixation";

export const POST = apiRoute(async ({ actor, body }) => previewFixation(actor, await body(z.unknown())));
