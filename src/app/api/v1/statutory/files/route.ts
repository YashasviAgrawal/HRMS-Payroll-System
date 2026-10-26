import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { makeStatFile, monthFiles, STAT_KINDS } from "@/modules/statutory/stat-files";

/** S-52: a month's statutory files (NPS CRA, ECR, ESIC, pension fund) — what each holds and what has been made. */
export const GET = apiRoute(async ({ actor, query }) => monthFiles(actor, query(z.object({ month: z.string().optional() })).month));

/** Builds one file and sends it to an Admin to release (ST-09). */
export const POST = apiRoute(async ({ actor, body }) => {
  const { kind, month } = await body(z.object({ kind: z.enum(STAT_KINDS), month: z.string() }));
  const file = await makeStatFile(actor, kind, month);
  return { id: file.id };
});
