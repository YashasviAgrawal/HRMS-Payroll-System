import { apiRoute } from "@/lib/api/route";
import { generatePranFile } from "@/modules/recruitment/files";

export const POST = apiRoute(async ({ actor }) => {
  const f = await generatePranFile(actor);
  return { id: f.id };
});
