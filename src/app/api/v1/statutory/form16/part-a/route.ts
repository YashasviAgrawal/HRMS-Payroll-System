import { apiRoute } from "@/lib/api/route";
import { badRequest } from "@/lib/errors";
import { importPartA } from "@/modules/statutory/form16";

/** ST-07: Part A PDFs from TRACES, matched by the PAN in each file name. */
export const POST = apiRoute(async ({ actor, req }) => {
  const form = await req.formData();
  const fy = String(form.get("fy") ?? "");
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) throw badRequest("errors.validation", { files: "validation.required" });
  return importPartA(actor, fy, files);
});
