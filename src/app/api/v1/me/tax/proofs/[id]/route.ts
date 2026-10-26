import { apiRoute } from "@/lib/api/route";
import { removeProof } from "@/modules/statutory/tax";

export const DELETE = apiRoute<{ id: string }>(async ({ actor, params }) => removeProof(actor, params.id));
