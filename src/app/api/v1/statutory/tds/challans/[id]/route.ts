import { apiRoute } from "@/lib/api/route";
import { removeChallan } from "@/modules/statutory/tds";

/** A challan entered by mistake, until its quarter's 24Q is released. */
export const DELETE = apiRoute<{ id: string }>(async ({ actor, params }) => removeChallan(actor, params.id));
