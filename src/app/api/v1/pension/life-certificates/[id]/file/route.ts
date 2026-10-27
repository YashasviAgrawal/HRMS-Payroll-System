import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { lifeCertificateFile } from "@/modules/pension/life-certificates";

/** PN-06: a certificate's scan, for the Pension clerk or the pensioner. */
export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => {
  const f = await lifeCertificateFile(actor, params.id);
  return fileResponse(f.buffer, { fileName: f.fileName, mimeType: f.mimeType, inline: true });
});
