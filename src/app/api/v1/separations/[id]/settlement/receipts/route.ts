import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { recordReceipt } from "@/modules/payroll/settlement";

/** Money paid back by the person when the recoveries are more than the dues. */
export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => recordReceipt(actor, params.id, await body(z.unknown())));
