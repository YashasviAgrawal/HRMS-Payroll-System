import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { otpField } from "@/lib/validators";
import { confirmMobileChange } from "@/modules/auth/service";

const schema = z.object({ challengeId: z.string().min(10).max(64), otp: otpField });

export const POST = apiRoute(async ({ actor, body }) => {
  await confirmMobileChange(actor, await body(schema));
  return { changed: true };
});
