import { apiRoute } from "@/lib/api/route";
import { proposeEmployeeDeath } from "@/modules/pension/events";

/** PN-11: a death in service — a Checker approves; pay stops and a family pension case starts. */
export const POST = apiRoute(async ({ actor, req }) => {
  const raw = (await req.json()) as { employeeId?: string };
  return proposeEmployeeDeath(actor, String(raw.employeeId ?? ""), raw);
});
