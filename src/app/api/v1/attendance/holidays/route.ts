import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { listHolidays, submitHolidayList } from "@/modules/attendance/holidays";

export const GET = apiRoute(async ({ actor, query }) => listHolidays(actor, query(z.object({ year: z.coerce.number().int().min(2000).max(2100) })).year));
export const POST = apiRoute(async ({ actor, body }) => {
  const task = await submitHolidayList(actor, await body(z.unknown()));
  return { taskId: task.id };
});
