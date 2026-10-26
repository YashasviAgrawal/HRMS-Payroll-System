import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { isoDateField } from "@/lib/validators";
import { listAudit } from "@/modules/audit/service";

const schema = z.object({
  q: z.string().max(100).optional(),
  action: z.string().max(40).optional(),
  userId: z.string().max(40).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(60).optional(),
  from: isoDateField.optional(),
  to: isoDateField.optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export const GET = apiRoute(async ({ actor, query }) => listAudit(actor, query(schema)));
