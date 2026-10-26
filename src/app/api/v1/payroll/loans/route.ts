import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { listLoans, sanctionLoan } from "@/modules/payroll/loans";

export const GET = apiRoute(async ({ actor, query }) => listLoans(actor, query(z.object({ status: z.string().optional(), employeeId: z.string().optional() }))));

export const POST = apiRoute(async ({ actor, body }) => {
  const loan = await sanctionLoan(actor, await body(z.unknown()));
  return { id: loan.id };
});
