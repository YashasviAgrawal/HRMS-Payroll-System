import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { notFound } from "@/lib/errors";
import { form16File } from "@/modules/statutory/form16";

/** A Form 16 part as a PDF — HR & Accounts any time, the employee once published. */
export const GET = apiRoute<{ id: string; part: string }>(async ({ actor, params }) => {
  if (params.part !== "A" && params.part !== "B") throw notFound();
  const { buffer, fileName } = await form16File(actor, params.id, params.part);
  return fileResponse(buffer, { fileName, mimeType: "application/pdf", inline: true });
});
