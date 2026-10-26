import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { changePassword } from "@/modules/auth/service";

const schema = z.object({ currentPassword: z.string().max(200).optional(), newPassword: z.string().min(1).max(200) });

export const POST = apiRoute(async ({ actor, body }) => {
  await changePassword(actor, await body(schema));
  return { changed: true };
});
