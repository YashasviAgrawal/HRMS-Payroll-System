import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { matrixTemplate } from "@/modules/payroll/rates";

export const GET = apiRoute(async ({ actor }) => fileResponse(await matrixTemplate(actor), { fileName: "pay-matrix-template.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
