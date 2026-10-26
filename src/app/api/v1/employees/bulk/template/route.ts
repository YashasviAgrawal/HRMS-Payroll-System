import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { mimeOf } from "@/lib/storage";
import { buildTemplate } from "@/modules/employees/bulk";

export const GET = apiRoute(async ({ actor }) =>
  fileResponse(await buildTemplate(actor), { fileName: "DCB-employee-upload-template.xlsx", mimeType: mimeOf("xlsx") }),
);
