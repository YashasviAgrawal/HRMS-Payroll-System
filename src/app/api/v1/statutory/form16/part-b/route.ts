import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { generatePartB } from "@/modules/statutory/form16";

/** ST-07: Part B for everyone paid in the year. */
export const POST = apiRoute(async ({ actor, body }) => generatePartB(actor, (await body(z.object({ fy: z.string() }))).fy));
