import { apiRoute } from "@/lib/api/route";
import { getApplication } from "@/modules/leave/service";

export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => getApplication(actor, params.id));
