import { apiRoute } from "@/lib/api/route";
import { buildSalaryBankFile } from "@/modules/payroll/pay";

export const POST = apiRoute<{ id: string }>(async ({ actor, params }) => {
  const file = await buildSalaryBankFile(actor, params.id);
  return { fileId: file.id };
});
