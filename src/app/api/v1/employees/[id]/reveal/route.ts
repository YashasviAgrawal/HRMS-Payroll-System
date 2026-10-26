import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { revealIdentifier } from "@/modules/employees/service";

const schema = z.object({ field: z.enum(["pan", "bankAccount"]) });

/** Full PAN / bank number to check against a document. Every look is written to the audit trail. */
export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => ({ value: await revealIdentifier(actor, params.id, (await body(schema)).field) }));
