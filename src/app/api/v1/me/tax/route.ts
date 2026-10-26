import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { myTax, saveMyDeclaration } from "@/modules/statutory/tax";

/** ST-02, ST-03: my regime and declaration for this year, with the figures to compare the regimes. */
export const GET = apiRoute(async ({ actor }) => myTax(actor));

/** Saves a draft, or sends it to HR & Accounts with `submit: true`. */
export const PUT = apiRoute(async ({ actor, body }) => saveMyDeclaration(actor, await body(z.unknown())));
