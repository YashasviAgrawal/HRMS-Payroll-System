import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { listPensioners, proposeNewPensioner } from "@/modules/pension/pensioners";

/** S-60: pensioners, with life certificate status. */
export const GET = apiRoute(async ({ actor, query }) => {
  const f = query(z.object({ q: z.string().max(60).optional(), status: z.enum(["ACTIVE", "STOPPED", "ALL"]).optional(), lc: z.enum(["VALID", "DUE_SOON", "OVERDUE", "HELD", "WAITING"]).optional() }));
  return listPensioners(actor, f);
});

/** PN-01: a pensioner from the old records — a Checker approves. */
export const POST = apiRoute(async ({ actor, req }) => proposeNewPensioner(actor, await req.json()));
