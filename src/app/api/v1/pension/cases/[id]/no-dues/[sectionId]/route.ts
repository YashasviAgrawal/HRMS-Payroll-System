import { apiRoute } from "@/lib/api/route";
import { setNoDues } from "@/modules/pension/cases";

/** PN-07: a section's answer to the no-dues checklist. */
export const PUT = apiRoute<{ id: string; sectionId: string }>(async ({ actor, params, req }) => setNoDues(actor, params.id, params.sectionId, await req.json()));
