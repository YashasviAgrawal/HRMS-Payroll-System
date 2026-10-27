import { apiRoute } from "@/lib/api/route";
import { formFile } from "@/lib/api/files";
import { addLifeCertificate } from "@/modules/pension/life-certificates";

/** PN-06: a certificate seen at the office (with its scan, optional). */
export const POST = apiRoute<{ id: string }>(async ({ actor, params, req }) => {
  const { file, form } = await formFile(req);
  return addLifeCertificate(actor, params.id, { source: form.get("source"), certifiedOn: form.get("certifiedOn"), jpId: form.get("jpId") ?? undefined, note: form.get("note") ?? undefined }, file && file.size > 0 ? file : null);
});
