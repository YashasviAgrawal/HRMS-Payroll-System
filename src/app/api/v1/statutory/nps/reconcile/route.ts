import { apiRoute } from "@/lib/api/route";
import { formFile } from "@/lib/api/files";
import { badRequest } from "@/lib/errors";
import { reconcileCra } from "@/modules/statutory/stat-files";

/** §9 NPS: the CRA statement of credits, matched PRAN by PRAN with the pay bills. */
export const POST = apiRoute(async ({ actor, req }) => {
  const { file } = await formFile(req);
  if (!file) throw badRequest("errors.validation", { file: "validation.required" });
  if (file.size > 5 * 1024 * 1024) throw badRequest("employees.errors.fileTooBig");
  return reconcileCra(actor, file.name, Buffer.from(await file.arrayBuffer()));
});
