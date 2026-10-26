import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getDeclaration } from "@/modules/statutory/tax";

/** One person's year (the id is the employee's): declaration, proofs, carried-in salary and the tax both ways. */
export const GET = apiRoute<{ id: string }>(async ({ actor, params, query }) => getDeclaration(actor, params.id, query(z.object({ fy: z.string().optional() })).fy));
