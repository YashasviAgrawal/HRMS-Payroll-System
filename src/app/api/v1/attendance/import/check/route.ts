import { apiRoute } from "@/lib/api/route";
import { formFile } from "@/lib/api/files";
import { badRequest } from "@/lib/errors";
import { checkPunchFile } from "@/modules/attendance/imports";
import { formatField } from "@/modules/attendance/schema";

export const POST = apiRoute(async ({ actor, req }) => {
  const { file, form } = await formFile(req);
  if (!file) throw badRequest("errors.validation", { file: "validation.required" });
  if (file.size > 5 * 1024 * 1024) throw badRequest("employees.errors.fileTooBig");
  const format = formatField.parse(form.get("format"));
  return checkPunchFile(actor, Buffer.from(await file.arrayBuffer()), file.name, format);
});
