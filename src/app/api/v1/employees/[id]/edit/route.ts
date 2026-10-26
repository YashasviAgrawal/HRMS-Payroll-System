import { apiRoute } from "@/lib/api/route";
import { badRequest } from "@/lib/errors";
import { proposeEdit, type EditTab } from "@/modules/employees/service";

/** HR proposes a change to one tab; it applies when a Checker approves (EM-07). */
export const POST = apiRoute<{ id: string }>(async ({ actor, params, req }) => {
  const body = (await req.json().catch(() => null)) as ({ tab?: string } & Record<string, unknown>) | null;
  if (!body || !["personal", "job", "ids"].includes(String(body.tab))) throw badRequest();
  return proposeEdit(actor, params.id, body.tab as EditTab, body);
});
