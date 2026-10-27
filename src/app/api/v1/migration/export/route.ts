import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { exportAllData } from "@/modules/migration/export";

/** PRD §16 data ownership: every table as CSV and JSON (Admin only, logged). */
export const GET = apiRoute(async ({ actor }) => {
  const { buffer, fileName } = await exportAllData(actor);
  return fileResponse(buffer, { fileName, mimeType: "application/zip" });
});
