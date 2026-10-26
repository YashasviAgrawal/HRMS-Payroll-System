import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { monthField } from "@/modules/attendance/schema";
import { myAttendance } from "@/modules/attendance/service";

export const GET = apiRoute(async ({ actor, query }) => myAttendance(actor, query(z.object({ month: monthField })).month));
