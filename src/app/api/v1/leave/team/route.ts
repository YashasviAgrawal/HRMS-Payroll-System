import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { monthField } from "@/modules/attendance/schema";
import { teamLeave } from "@/modules/leave/service";

export const GET = apiRoute(async ({ actor, query }) => teamLeave(actor, query(z.object({ month: monthField })).month));
