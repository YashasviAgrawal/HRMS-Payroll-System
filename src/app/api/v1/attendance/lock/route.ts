import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { monthField } from "@/modules/attendance/schema";
import { lockMonth, lockPreview } from "@/modules/attendance/service";

export const GET = apiRoute(async ({ actor, query }) => {
  const q = query(z.object({ section: z.string().min(1), month: monthField }));
  return lockPreview(actor, q.section, q.month);
});
export const POST = apiRoute(async ({ actor, body }) => {
  const lock = await lockMonth(actor, await body(z.unknown()));
  return { id: lock.id, lockedAt: lock.lockedAt };
});
