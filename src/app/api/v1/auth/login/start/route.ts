import { z } from "zod";
import { publicRoute } from "@/lib/api/route";
import { LoginType } from "@/generated/prisma/enums";
import { startLogin } from "@/modules/auth/service";

const schema = z.object({
  loginType: z.enum(LoginType),
  method: z.enum(["password", "otp"]),
  identifier: z.string().trim().min(3).max(40),
  password: z.string().max(200).optional(),
});

export const POST = publicRoute(async ({ body, meta }) => startLogin(await body(schema), meta));
