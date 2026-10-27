import { apiRoute } from "@/lib/api/route";
import { overviewScreen } from "@/modules/migration/console";

/** S-90: where each §15 step stands. */
export const GET = apiRoute(async ({ actor }) => overviewScreen(actor));
