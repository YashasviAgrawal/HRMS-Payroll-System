import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { RUN_GROUPS } from "@/modules/payroll/compute";
import { joinerCandidates, withheldCandidates } from "@/modules/payroll/arrears";

export const GET = apiRoute(async ({ actor, query }) => {
  const q = query(z.object({ type: z.enum(["WITHHELD", "JOINER"]), payGroup: z.enum(RUN_GROUPS), month: z.string().optional() }));
  return q.type === "WITHHELD" ? { people: await withheldCandidates(actor, q.payGroup) } : joinerCandidates(actor, q.payGroup, q.month ?? "");
});
