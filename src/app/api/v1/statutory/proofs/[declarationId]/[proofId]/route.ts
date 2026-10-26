import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { readProof } from "@/modules/statutory/tax";

/** ST-03: a tax proof, for its owner and for HR & Accounts. */
export const GET = apiRoute<{ declarationId: string; proofId: string }>(async ({ actor, params }) => {
  const { buffer, proof } = await readProof(actor, params.declarationId, params.proofId);
  return fileResponse(buffer, { fileName: proof.name, mimeType: proof.mimeType, inline: true });
});
