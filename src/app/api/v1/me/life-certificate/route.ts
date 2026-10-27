import { apiRoute } from "@/lib/api/route";
import { formFile } from "@/lib/api/files";
import { myLifeCertificate, submitLifeCertificate } from "@/modules/pension/life-certificates";

/** PN-12: my life certificate status and history. */
export const GET = apiRoute(async ({ actor }) => myLifeCertificate(actor));

/** PN-06: a Jeevan Pramaan certificate I upload; the Pension clerk checks it. */
export const POST = apiRoute(async ({ actor, req }) => {
  const { file, form } = await formFile(req);
  return submitLifeCertificate(actor, { certifiedOn: form.get("certifiedOn"), jpId: form.get("jpId") ?? undefined, note: form.get("note") ?? undefined }, file && file.size > 0 ? file : null);
});
