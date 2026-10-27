import { apiRoute } from "@/lib/api/route";
import { pensionerProfile, proposePensionerEdit } from "@/modules/pension/pensioners";

/** S-60: one pensioner's record. */
export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => pensionerProfile(actor, params.id));

/** PN-01: a change to the record — a Checker approves. */
export const PATCH = apiRoute<{ id: string }>(async ({ actor, params, req }) => proposePensionerEdit(actor, params.id, await req.json()));
