import { apiRoute } from "@/lib/api/route";
import { craReconciliations, npsAccounts } from "@/modules/statutory/stat-files";

/** S-50 NPS: contributions per person and the CRA statements checked so far. */
export const GET = apiRoute(async ({ actor }) => ({ accounts: await npsAccounts(actor), reconciliations: await craReconciliations(actor) }));
