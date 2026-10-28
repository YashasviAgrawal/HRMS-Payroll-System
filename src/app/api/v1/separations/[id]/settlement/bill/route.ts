import { apiRoute } from "@/lib/api/route";
import { makeSettlementBill } from "@/modules/payroll/settlement";

/** Makes the settlement bill (a supplementary bill) that pays the approved net. */
export const POST = apiRoute<{ id: string }>(async ({ actor, params }) => {
  const run = await makeSettlementBill(actor, params.id);
  return { runId: run.id };
});
