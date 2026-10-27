import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { verificationSheetPdf } from "@/modules/migration/verify";

/** The printed record sheet for a person who does not use the system. */
export const GET = apiRoute<{ employeeId: string }>(async ({ actor, params }) => {
  const { pdf, fileName } = await verificationSheetPdf(actor, params.employeeId);
  return fileResponse(pdf, { fileName, mimeType: "application/pdf", inline: true });
});
