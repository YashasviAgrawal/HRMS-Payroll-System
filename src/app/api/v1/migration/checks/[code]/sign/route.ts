import { apiRoute } from "@/lib/api/route";
import { signCheck } from "@/modules/migration/checks";

export const POST = apiRoute<{ code: string }>(async ({ actor, params }) => {
  await signCheck(actor, params.code);
  return { ok: true };
});
