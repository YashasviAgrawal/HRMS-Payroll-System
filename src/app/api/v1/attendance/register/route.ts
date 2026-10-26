import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { monthField } from "@/modules/attendance/schema";
import { sectionRegister } from "@/modules/attendance/service";

export const GET = apiRoute(async ({ actor, query }) => {
  const q = query(z.object({ section: z.string().min(1), month: monthField }));
  return sectionRegister(actor, q.section, q.month);
});
