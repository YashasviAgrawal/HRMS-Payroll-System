import { apiRoute } from "@/lib/api/route";
import { completeJoining } from "@/modules/recruitment/service";

export const POST = apiRoute<{ id: string }>(async ({ actor, params }) => {
  const task = await completeJoining(actor, params.id);
  return { taskId: task.id };
});
