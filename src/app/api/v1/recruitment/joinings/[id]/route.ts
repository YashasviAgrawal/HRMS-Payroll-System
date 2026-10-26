import { apiRoute } from "@/lib/api/route";
import { getJoining } from "@/modules/recruitment/service";

export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => getJoining(actor, params.id));
