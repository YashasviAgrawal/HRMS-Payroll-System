import { apiRoute } from "@/lib/api/route";
import { parseTarget } from "@/modules/migration/mapping";
import { submitLoad } from "@/modules/migration/loads";

/** §15 step 8: what is mapped and clean goes to a Checker as one batch. */
export const POST = apiRoute<{ target: string }>(async ({ actor, params }) => submitLoad(actor, parseTarget(params.target)));
