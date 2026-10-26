import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { resetPassword } from "@/modules/users/service";

const schema = z.object({ temporaryPassword: z.string().min(1).max(200) });

export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  await resetPassword(actor, params.id, (await body(schema)).temporaryPassword);
  return { ok: true };
});
