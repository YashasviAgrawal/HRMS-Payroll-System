import { apiRoute } from "@/lib/api/route";
import { formFile } from "@/lib/api/files";
import { badRequest } from "@/lib/errors";
import { listDocuments, uploadDocument } from "@/modules/employees/records";

export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => listDocuments(actor, params.id));
export const POST = apiRoute<{ id: string }>(async ({ actor, params, req }) => {
  const { file, form } = await formFile(req);
  if (!file) throw badRequest("errors.validation", { file: "validation.required" });
  const doc = await uploadDocument(actor, params.id, file, { category: String(form.get("category") ?? "OTHER"), title: String(form.get("title") ?? "") });
  return { id: doc.id, title: doc.title };
});
