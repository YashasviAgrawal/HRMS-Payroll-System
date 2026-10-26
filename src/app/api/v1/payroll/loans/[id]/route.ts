import { apiRoute } from "@/lib/api/route";
import { getLoan } from "@/modules/payroll/loans";

export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => getLoan(actor, params.id));
