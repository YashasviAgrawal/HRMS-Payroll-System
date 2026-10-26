import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { revealProposed } from "@/modules/employees/service";

const schema = z.object({ field: z.enum(["pan", "bankAccount"]) });

export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => ({ value: await revealProposed(actor, params.id, (await body(schema)).field) }));
