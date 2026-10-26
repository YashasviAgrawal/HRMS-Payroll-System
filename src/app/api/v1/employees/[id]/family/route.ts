import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getFamily, proposeFamily } from "@/modules/employees/records";

export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => getFamily(actor, params.id));
export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => proposeFamily(actor, params.id, await body(z.unknown())));
