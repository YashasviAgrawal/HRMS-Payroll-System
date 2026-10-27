import { apiRoute } from "@/lib/api/route";
import { getCase, updateCase } from "@/modules/pension/cases";

/** S-62: one case — inputs, working, no-dues, approval. */
export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => getCase(actor, params.id));

/** Change the inputs of a draft and work it out again. */
export const PATCH = apiRoute<{ id: string }>(async ({ actor, params, req }) => updateCase(actor, params.id, await req.json()));
