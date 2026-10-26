import { apiRoute } from "@/lib/api/route";
import { gpfAccounts } from "@/modules/statutory/gpf";

/** S-50: every GPF account with its balance. */
export const GET = apiRoute(async ({ actor }) => gpfAccounts(actor));
