import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { lookupEmployees } from "@/modules/users/service";

export const GET = apiRoute(async ({ actor, query }) => lookupEmployees(actor, query(z.object({ q: z.string().default("") })).q));
