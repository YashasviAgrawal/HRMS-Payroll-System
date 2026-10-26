import { apiRoute } from "@/lib/api/route";
import { getVacancy } from "@/modules/recruitment/service";

export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => getVacancy(actor, params.id));
