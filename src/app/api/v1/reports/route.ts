import { apiRoute } from "@/lib/api/route";
import { reportsFor } from "@/modules/reports/registry";

/** S-70: the standard reports this login may open. */
export const GET = apiRoute(async ({ actor }) => ({ reports: reportsFor(actor).map((r) => ({ no: r.no, key: r.key, area: r.area, filters: r.filters })) }));
