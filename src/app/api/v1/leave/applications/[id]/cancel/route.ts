import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { cancelLeave } from "@/modules/leave/service";

export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  const a = await cancelLeave(actor, params.id, await body(z.unknown()));
  return { id: a.id, status: a.status };
});
