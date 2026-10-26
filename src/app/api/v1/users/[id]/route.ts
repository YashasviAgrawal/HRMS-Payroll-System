import { apiRoute } from "@/lib/api/route";
import { getUser, updateUser, userUpdateSchema } from "@/modules/users/service";

export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => getUser(actor, params.id));
export const PATCH = apiRoute<{ id: string }>(async ({ actor, params, body }) => updateUser(actor, params.id, await body(userUpdateSchema)));
