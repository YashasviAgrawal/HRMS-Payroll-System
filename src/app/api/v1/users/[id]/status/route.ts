import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { setUserStatus } from "@/modules/users/service";

const schema = z.object({ status: z.enum(["ACTIVE", "DISABLED"]) });

export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  await setUserStatus(actor, params.id, (await body(schema)).status);
  return { ok: true };
});
