import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { updateSectionRules } from "@/modules/attendance/service";

export const PUT = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  const s = await updateSectionRules(actor, params.id, await body(z.unknown()));
  return { id: s.id, attendanceMode: s.attendanceMode, weeklyOff: s.weeklyOff };
});
