import { apiRoute } from "@/lib/api/route";
import { fieldHistory } from "@/modules/employees/service";

export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => fieldHistory(actor, params.id));
