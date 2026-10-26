import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { downloadFile } from "@/lib/files";

export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => {
  const { buffer, file } = await downloadFile(actor, params.id);
  return fileResponse(buffer, { fileName: file.fileName, mimeType: file.mimeType });
});
