import { apiRoute } from "@/lib/api/route";
import { getTask } from "@/lib/approvals";

export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => getTask(actor, params.id));
