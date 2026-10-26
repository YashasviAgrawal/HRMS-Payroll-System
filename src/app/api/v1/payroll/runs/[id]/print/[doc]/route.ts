import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { notFound } from "@/lib/errors";
import { PRINT_DOCS, payrollPdf, type PrintDoc } from "@/modules/payroll/outputs";

export const GET = apiRoute<{ id: string; doc: string }>(async ({ actor, params }) => {
  if (!(PRINT_DOCS as readonly string[]).includes(params.doc)) throw notFound();
  const { pdf, fileName } = await payrollPdf(actor, params.id, params.doc as PrintDoc);
  return fileResponse(pdf, { fileName, mimeType: "application/pdf", inline: true });
});
