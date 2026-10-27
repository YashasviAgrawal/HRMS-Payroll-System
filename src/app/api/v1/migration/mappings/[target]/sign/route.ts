import { apiRoute } from "@/lib/api/route";
import { parseTarget, signMapping } from "@/modules/migration/mapping";

/** Accounts signs the mapping sheet off. */
export const POST = apiRoute<{ target: string }>(async ({ actor, params }) => {
  await signMapping(actor, parseTarget(params.target));
  return { ok: true };
});
