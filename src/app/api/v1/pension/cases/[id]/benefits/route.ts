import { apiRoute } from "@/lib/api/route";
import { makeBenefitsBill } from "@/modules/pension/bills";

/** PN-10: the retirement benefits bill (gratuity, commuted value, leave encashment). */
export const POST = apiRoute<{ id: string }>(async ({ actor, params }) => {
  const run = await makeBenefitsBill(actor, params.id);
  return { id: run.id };
});
