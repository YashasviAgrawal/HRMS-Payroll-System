import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { listJoinings, startDirectJoining } from "@/modules/recruitment/service";

export const GET = apiRoute(async ({ actor }) => listJoinings(actor));
export const POST = apiRoute(async ({ actor, body }) => {
  const j = await startDirectJoining(actor, await body(z.unknown()));
  return { id: j.id };
});
