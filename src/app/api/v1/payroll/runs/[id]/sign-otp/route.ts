import { apiRoute } from "@/lib/api/route";
import { startSigning } from "@/modules/payroll/run";

export const POST = apiRoute<{ id: string }>(async ({ actor, params, meta }) => startSigning(actor, params.id, meta));
