import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { mobileField } from "@/lib/validators";
import { startMobileChange } from "@/modules/auth/service";

const schema = z.object({ mobile: mobileField });

export const POST = apiRoute(async ({ actor, body, meta }) => startMobileChange(actor, (await body(schema)).mobile, meta));
