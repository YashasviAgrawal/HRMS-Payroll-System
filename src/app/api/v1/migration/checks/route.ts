import { apiRoute } from "@/lib/api/route";
import { checksScreen } from "@/modules/migration/checks";

/** The §15 checks table with its figures and signatures. */
export const GET = apiRoute(async ({ actor }) => checksScreen(actor));
