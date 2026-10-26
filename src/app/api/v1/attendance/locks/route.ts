import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { monthField } from "@/modules/attendance/schema";
import { lockOverview } from "@/modules/attendance/service";

export const GET = apiRoute(async ({ actor, query }) => lockOverview(actor, query(z.object({ month: monthField })).month));
