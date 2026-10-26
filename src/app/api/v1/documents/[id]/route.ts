import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { deleteDocument, readDocument } from "@/modules/employees/records";

export const GET = apiRoute<{ id: string }>(async ({ actor, params, req }) => {
  const { buffer, doc } = await readDocument(actor, params.id);
  return fileResponse(buffer, { fileName: doc.fileName, mimeType: doc.mimeType, inline: req.nextUrl.searchParams.get("view") === "1" });
});
export const DELETE = apiRoute<{ id: string }>(async ({ actor, params }) => {
  await deleteDocument(actor, params.id);
  return { deleted: true };
});
