import { apiRoute } from "@/lib/api/route";
import { formFile } from "@/lib/api/files";
import { badRequest } from "@/lib/errors";
import { proposeMatrix } from "@/modules/payroll/rates";

export const POST = apiRoute(async ({ actor, req }) => {
  const { file, form } = await formFile(req);
  if (!file) throw badRequest("errors.validation", { file: "validation.required" });
  if (file.size > 5 * 1024 * 1024) throw badRequest("employees.errors.fileTooBig");
  const task = await proposeMatrix(actor, Buffer.from(await file.arrayBuffer()), { name: String(form.get("name") ?? ""), effectiveFrom: String(form.get("effectiveFrom") ?? "") });
  return { taskId: task.id };
});
