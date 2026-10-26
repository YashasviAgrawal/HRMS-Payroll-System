import { apiRoute } from "@/lib/api/route";
import { formFile } from "@/lib/api/files";
import { badRequest } from "@/lib/errors";
import { importApplicants } from "@/modules/recruitment/service";

export const POST = apiRoute<{ id: string }>(async ({ actor, params, req }) => {
  const { file } = await formFile(req);
  if (!file) throw badRequest("errors.validation", { file: "validation.required" });
  if (file.size > 10 * 1024 * 1024) throw badRequest("employees.errors.fileTooBig");
  return importApplicants(actor, params.id, Buffer.from(await file.arrayBuffer()));
});
