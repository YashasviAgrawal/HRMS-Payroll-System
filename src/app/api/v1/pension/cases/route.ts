import { apiRoute } from "@/lib/api/route";
import { casesOverview, createCase } from "@/modules/pension/cases";

/** S-62: retirements ahead (alerts at 12 and 6 months) and every pension case. */
export const GET = apiRoute(async ({ actor }) => casesOverview(actor));

/** PN-08: start a case — worked out at once from the records. */
export const POST = apiRoute(async ({ actor, req }) => createCase(actor, await req.json()));
