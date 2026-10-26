import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { openRequests, submitAttendanceRequest } from "@/modules/attendance/service";

export const GET = apiRoute(async ({ actor }) => openRequests(actor));
export const POST = apiRoute(async ({ actor, body }) => {
  const r = await submitAttendanceRequest(actor, await body(z.unknown()));
  return { id: r.id };
});
