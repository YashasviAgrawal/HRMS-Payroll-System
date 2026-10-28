import { apiRoute } from "@/lib/api/route";
import { uploadServiceBooks } from "@/modules/employees/records";

/** Scanned service books, up to 20 files a request; each file name starts with the Employee ID. */
export const POST = apiRoute(async ({ actor, req }) => {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  return uploadServiceBooks(actor, files);
});
