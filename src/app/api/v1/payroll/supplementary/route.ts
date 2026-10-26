import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { makeSupplementaryBill, supplementaryBills } from "@/modules/payroll/arrears";

export const GET = apiRoute(async ({ actor }) => supplementaryBills(actor));

export const POST = apiRoute(async ({ actor, body }) => {
  const run = await makeSupplementaryBill(actor, await body(z.unknown()));
  return { id: run.id };
});
