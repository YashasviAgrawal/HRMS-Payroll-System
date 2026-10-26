import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { forbidden } from "@/lib/errors";
import { mimeOf } from "@/lib/storage";
import { punchTemplate } from "@/modules/attendance/formats";
import { canEnterMuster } from "@/modules/attendance/service";

export const GET = apiRoute(async ({ actor }) => {
  if (!canEnterMuster(actor)) throw forbidden();
  return fileResponse(await punchTemplate(), { fileName: "DCB-punch-template.xlsx", mimeType: mimeOf("xlsx") });
});
