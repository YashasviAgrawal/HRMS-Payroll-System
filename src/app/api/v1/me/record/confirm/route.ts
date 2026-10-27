import { apiRoute } from "@/lib/api/route";
import { confirmOwnRecord } from "@/modules/migration/verify";

/** §15 step 7: the person confirms their own record online. */
export const POST = apiRoute(async ({ actor }) => confirmOwnRecord(actor));
