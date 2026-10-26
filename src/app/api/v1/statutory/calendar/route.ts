import { apiRoute } from "@/lib/api/route";
import { statutoryCalendar } from "@/modules/statutory/calendar-service";

/** ST-08: due dates for the next three months and anything overdue, each marked done or not. */
export const GET = apiRoute(async ({ actor }) => statutoryCalendar(actor));
