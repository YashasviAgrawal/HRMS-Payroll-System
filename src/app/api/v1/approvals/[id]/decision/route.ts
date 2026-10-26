import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { decide } from "@/lib/approvals";

const schema = z.object({ decision: z.enum(["APPROVE", "REJECT", "RETURN"]), note: z.string().max(1000).optional() });

export const POST = apiRoute<{ id: string }>(async ({ actor, params, body }) => {
  const { decision, note } = await body(schema);
  const task = await decide(actor, params.id, decision, note);
  return { id: task.id, status: task.status };
});
