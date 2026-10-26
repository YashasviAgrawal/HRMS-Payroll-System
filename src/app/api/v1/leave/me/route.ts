import { apiRoute } from "@/lib/api/route";
import { myLeave } from "@/modules/leave/service";

export const GET = apiRoute(async ({ actor }) => myLeave(actor));
