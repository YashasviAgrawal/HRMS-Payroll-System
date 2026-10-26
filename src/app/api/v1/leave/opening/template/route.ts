import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { mimeOf } from "@/lib/storage";
import { openingTemplate } from "@/modules/leave/opening";

export const GET = apiRoute(async ({ actor }) => fileResponse(await openingTemplate(actor), { fileName: "DCB-opening-leave-balances.xlsx", mimeType: mimeOf("xlsx") }));
