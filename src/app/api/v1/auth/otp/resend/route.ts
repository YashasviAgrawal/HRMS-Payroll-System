import { z } from "zod";
import { publicRoute } from "@/lib/api/route";
import { resendOtp } from "@/modules/auth/service";

const schema = z.object({ challengeId: z.string().min(10).max(64) });

export const POST = publicRoute(async ({ body, meta }) => resendOtp((await body(schema)).challengeId, meta));
