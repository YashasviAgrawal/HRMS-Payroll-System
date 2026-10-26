import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { recordChallan } from "@/modules/statutory/tds";

/** ST-05: a challan recorded against a month's TDS. */
export const POST = apiRoute(async ({ actor, body }) => {
  const row = await recordChallan(actor, await body(z.unknown()));
  return { id: row.id };
});
