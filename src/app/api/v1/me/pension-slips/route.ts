import { apiRoute } from "@/lib/api/route";
import { myPensionSlips } from "@/modules/payroll/payslips";

/** PN-12: my pension slips once paid, newest first. */
export const GET = apiRoute(async ({ actor }) => myPensionSlips(actor));
