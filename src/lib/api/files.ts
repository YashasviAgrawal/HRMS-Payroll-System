import "server-only";

/** A file download response; names are sent RFC 5987-encoded so Hindi file names survive. */
export function fileResponse(buffer: Buffer, opts: { fileName: string; mimeType: string; inline?: boolean }) {
  const ascii = opts.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": opts.mimeType,
      "content-length": String(buffer.length),
      "content-disposition": `${opts.inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(opts.fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** Reads one uploaded file from a multipart form. */
export async function formFile(req: Request, field = "file") {
  const form = await req.formData();
  const file = form.get(field);
  return { file: file instanceof File ? file : null, form };
}
