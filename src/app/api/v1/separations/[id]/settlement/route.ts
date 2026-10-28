import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { saveSettlementInputs, settlementView } from "@/modules/payroll/settlement";

/** The full and final settlement: the statement and what can be done next. */
export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => settlementView(actor, params.id));
/** The Payroll clerk's entries while the statement is a draft. */
export const PUT = apiRoute<{ id: string }>(async ({ actor, params, body }) => saveSettlementInputs(actor, params.id, await body(z.unknown())));
