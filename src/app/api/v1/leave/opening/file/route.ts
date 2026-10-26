import { apiRoute } from "@/lib/api/route";
import { formFile } from "@/lib/api/files";
import { badRequest } from "@/lib/errors";
import { submitOpeningFile } from "@/modules/leave/opening";

export const POST = apiRoute(async ({ actor, req }) => {
  const { file, form } = await formFile(req);
  if (!file) throw badRequest("errors.validation", { file: "validation.required" });
  if (file.size > 10 * 1024 * 1024) throw badRequest("employees.errors.fileTooBig");
  const task = await submitOpeningFile(actor, Buffer.from(await file.arrayBuffer()), String(form.get("asOn") ?? ""));
  return { taskId: task.id };
});
