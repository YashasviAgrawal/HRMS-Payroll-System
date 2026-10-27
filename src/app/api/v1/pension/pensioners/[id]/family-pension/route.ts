import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { familyPensionDefaults } from "@/modules/pension/events";

/** PN-11: the family pension the death form suggests for a date of death. */
export const GET = apiRoute<{ id: string }>(async ({ actor, params, query }) => familyPensionDefaults(actor, params.id, query(z.object({ date: z.string().optional() })).date));
