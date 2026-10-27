import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { notFound } from "@/lib/errors";
import { lockRecords, markServiceBook, markSheet } from "@/modules/migration/verify";

/** HR compared with the service book, a signed sheet came back, or a Checker locks. */
export const POST = apiRoute<{ action: string }>(async ({ actor, params, body }) => {
  const input = await body(z.unknown());
  if (params.action === "service-book") return markServiceBook(actor, input);
  if (params.action === "sheet") return markSheet(actor, input);
  if (params.action === "lock") return lockRecords(actor, input);
  throw notFound();
});
