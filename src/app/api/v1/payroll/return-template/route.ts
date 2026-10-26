import { apiRoute } from "@/lib/api/route";
import { fileResponse } from "@/lib/api/files";
import { toCsv } from "@/lib/csv";
import { RETURN_COLUMNS, RETURN_SAMPLE } from "@/modules/payroll/bank-formats";

export const GET = apiRoute(async () => fileResponse(Buffer.from(toCsv([...RETURN_COLUMNS], RETURN_SAMPLE), "utf8"), { fileName: "bank-return-template.csv", mimeType: "text/csv" }));
