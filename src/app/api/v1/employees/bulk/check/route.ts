import { apiRoute } from "@/lib/api/route";
import { formFile } from "@/lib/api/files";
import { badRequest } from "@/lib/errors";
import { checkBulkFile } from "@/modules/employees/bulk";

export const POST = apiRoute(async ({ actor, req }) => {
  const { file } = await formFile(req);
  if (!file) throw badRequest("errors.validation", { file: "validation.required" });
  if (file.size > 10 * 1024 * 1024) throw badRequest("employees.errors.fileTooBig");
  const rows = await checkBulkFile(actor, Buffer.from(await file.arrayBuffer()));
  return { rows: rows.map(({ row, name, employeeCode, errors }) => ({ row, name, employeeCode, errors })) };
});
