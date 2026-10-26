import { apiRoute } from "@/lib/api/route";
import { formFile } from "@/lib/api/files";
import { badRequest } from "@/lib/errors";
import { importReturnFile, markAllCredited } from "@/modules/payroll/pay";

/** Multipart with a file — the bank's return file; or JSON { allCredited: true } when nothing failed. */
export const POST = apiRoute<{ id: string }>(async ({ actor, params, req }) => {
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as { allCredited?: boolean };
    if (body.allCredited !== true) throw badRequest();
    return markAllCredited(actor, params.id);
  }
  const { file } = await formFile(req);
  if (!file) throw badRequest("errors.validation", { file: "validation.required" });
  if (file.size > 5 * 1024 * 1024) throw badRequest("employees.errors.fileTooBig");
  return importReturnFile(actor, params.id, Buffer.from(await file.arrayBuffer()), file.name);
});
