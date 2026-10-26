import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { previewLeave } from "@/modules/leave/service";

export const POST = apiRoute(async ({ actor, body }) => previewLeave(actor, await body(z.unknown())));
