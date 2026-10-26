import { apiRoute } from "@/lib/api/route";
import { resendNotices } from "@/modules/payroll/payslips";

/** SL-04: send payslip notices to everyone not yet sent. */
export const POST = apiRoute<{ id: string }>(async ({ actor, params }) => resendNotices(actor, params.id));
