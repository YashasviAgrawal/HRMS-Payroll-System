import { apiRoute } from "@/lib/api/route";
import { proposePensionerDeath } from "@/modules/pension/events";

/** PN-11: a pensioner's death — a Checker approves; family pension starts the next day. */
export const POST = apiRoute<{ id: string }>(async ({ actor, params, req }) => proposePensionerDeath(actor, params.id, await req.json()));
