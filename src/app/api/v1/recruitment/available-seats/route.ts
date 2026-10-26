import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { forbidden } from "@/lib/errors";
import { canAll } from "@/lib/auth/access";
import { availableSeats } from "@/modules/recruitment/service";

export const GET = apiRoute(async ({ actor, query }) => {
  if (!canAll(actor, "recruitment", "view")) throw forbidden();
  const q = query(z.object({ sectionId: z.string().min(1), postId: z.string().min(1) }));
  return { available: await availableSeats(actor.boardId, q.sectionId, q.postId) };
});
