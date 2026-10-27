import { apiRoute } from "@/lib/api/route";
import { makePensionArrearsBill } from "@/modules/pension/bills";

/** PN-05: one bill of arrears for every pensioner due them. */
export const POST = apiRoute(async ({ actor, req }) => {
  const run = await makePensionArrearsBill(actor, await req.json());
  return { id: run.id };
});
