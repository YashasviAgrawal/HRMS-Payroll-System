import { apiRoute } from "@/lib/api/route";
import { generateEpfEsicFile } from "@/modules/recruitment/files";

export const POST = apiRoute(async ({ actor }) => {
  const f = await generateEpfEsicFile(actor);
  return { id: f.id };
});
