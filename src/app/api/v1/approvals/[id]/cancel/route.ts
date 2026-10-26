import { apiRoute } from "@/lib/api/route";
import { cancelTask } from "@/lib/approvals";

export const POST = apiRoute<{ id: string }>(async ({ actor, params }) => {
  await cancelTask(actor, params.id);
  return { cancelled: true };
});
