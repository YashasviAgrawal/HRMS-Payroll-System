import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { previewArrears } from "@/modules/payroll/arrears";

export const POST = apiRoute(async ({ actor, body }) => previewArrears(actor, await body(z.unknown())));
