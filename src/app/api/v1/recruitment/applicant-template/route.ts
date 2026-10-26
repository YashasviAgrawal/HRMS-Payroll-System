import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { mimeOf } from "@/lib/storage";
import { applicantTemplate } from "@/modules/recruitment/service";

export const GET = apiRoute(async ({ actor }) => fileResponse(await applicantTemplate(actor), { fileName: "DCB-applicants-template.xlsx", mimeType: mimeOf("xlsx") }));
