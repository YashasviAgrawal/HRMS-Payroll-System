import { apiRoute } from "@/lib/api/route";
import { employeeLeave } from "@/modules/leave/service";

export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => employeeLeave(actor, params.id));
