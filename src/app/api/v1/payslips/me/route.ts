import { apiRoute } from "@/lib/api/route";
import { myPayslips } from "@/modules/payroll/payslips";

export const GET = apiRoute(async ({ actor }) => myPayslips(actor));
