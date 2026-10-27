import { apiRoute } from "@/lib/api/route";
import { previewPensionArrears } from "@/modules/pension/bills";

/** PN-05: who gets pension arrears for a period, before the bill is made. */
export const POST = apiRoute(async ({ actor, req }) => previewPensionArrears(actor, await req.json()));
