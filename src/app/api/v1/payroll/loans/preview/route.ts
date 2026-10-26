import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { canAll } from "@/lib/auth/access";
import { forbidden } from "@/lib/errors";
import { previewLoan } from "@/modules/payroll/loans";

export const POST = apiRoute(async ({ actor, body }) => {
  if (!canAll(actor, "arrears_loans", "create")) throw forbidden();
  return previewLoan(await body(z.unknown()));
});
