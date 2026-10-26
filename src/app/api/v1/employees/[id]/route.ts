import { apiRoute } from "@/lib/api/route";
import { getEmployee } from "@/modules/employees/service";

export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => getEmployee(actor, params.id));
