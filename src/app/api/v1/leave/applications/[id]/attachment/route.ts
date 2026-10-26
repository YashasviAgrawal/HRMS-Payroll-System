import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { readAttachment } from "@/modules/leave/service";

export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => {
  const f = await readAttachment(actor, params.id);
  return fileResponse(f.buffer, { fileName: f.name, mimeType: f.mimeType, inline: true });
});
