import { apiRoute } from "@/lib/api/route";
import { todayBoard } from "@/modules/attendance/service";

export const GET = apiRoute(async ({ actor }) => todayBoard(actor));
