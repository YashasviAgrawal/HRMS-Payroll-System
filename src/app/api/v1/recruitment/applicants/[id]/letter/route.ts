import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { appointmentLetterPdf } from "@/modules/recruitment/letter";
import { issueAppointmentLetter } from "@/modules/recruitment/service";

/** POST issues the letter number; GET prints the letter (Hindi + English PDF). */
export const POST = apiRoute<{ id: string }>(async ({ actor, params }) => {
  const a = await issueAppointmentLetter(actor, params.id);
  return { appointmentLetterNo: a.appointmentLetterNo };
});
export const GET = apiRoute<{ id: string }>(async ({ actor, params }) => {
  const { pdf, fileName } = await appointmentLetterPdf(actor, params.id);
  return fileResponse(pdf, { fileName, mimeType: "application/pdf", inline: true });
});
