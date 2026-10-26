import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { formFile } from "@/lib/api/files";
import { applyLeave, listApplications } from "@/modules/leave/service";

export const GET = apiRoute(async ({ actor, query }) => {
  const q = query(z.object({ status: z.enum(["PENDING", "APPROVED", "ALL"]).optional() }));
  return listApplications(actor, { status: q.status });
});

/** Multipart, so a medical certificate can come with the application. */
export const POST = apiRoute(async ({ actor, req }) => {
  const { file, form } = await formFile(req);
  const raw = {
    leaveCode: String(form.get("leaveCode") ?? ""),
    fromDate: String(form.get("fromDate") ?? ""),
    toDate: String(form.get("toDate") ?? ""),
    halfDay: form.get("halfDay") === "true",
    reason: String(form.get("reason") ?? ""),
    contact: String(form.get("contact") ?? "") || undefined,
  };
  const a = await applyLeave(actor, raw, file);
  return { id: a.id };
});
