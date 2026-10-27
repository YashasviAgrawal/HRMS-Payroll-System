import { apiRoute } from "@/lib/api/route";
import { listFiles, uploadFiles } from "@/modules/migration/staging";

/** §15 steps 1–3: files from the old system, kept with their checksum; tables staged row by row. */
export const GET = apiRoute(async ({ actor }) => ({ files: await listFiles(actor) }));

export const POST = apiRoute(async ({ actor, req }) => {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  return { results: await uploadFiles(actor, files) };
});
