import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { explainIssue } from "@/modules/migration/mapping";

/** §15 "Exceptions": an issue explained in writing. */
export const POST = apiRoute(async ({ actor, body }) => explainIssue(actor, await body(z.unknown())));
