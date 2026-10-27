import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { frozenFile } from "@/modules/migration/staging";

/** The frozen copy, byte for byte (its checksum is checked first). */
export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => {
  const { buffer, fileName } = await frozenFile(actor, params.id);
  return fileResponse(buffer, { fileName, mimeType: "application/octet-stream" });
});
