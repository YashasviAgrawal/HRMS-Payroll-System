import { apiRoute } from "@/lib/api/route";
import { cancelJoining } from "@/modules/recruitment/service";

export const POST = apiRoute<{ id: string }>(async ({ actor, params }) => {
  await cancelJoining(actor, params.id);
  return { ok: true };
});
