import { apiRoute } from "@/lib/api/route";
import { commutationTables, proposeCommutationTable } from "@/modules/pension/tables";

/** S-81: the commutation table, dated. */
export const GET = apiRoute(async ({ actor }) => commutationTables(actor));

/** A new table from a date — an Admin approves. */
export const POST = apiRoute(async ({ actor, req }) => proposeCommutationTable(actor, await req.json()));
