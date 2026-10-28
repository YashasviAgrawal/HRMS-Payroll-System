"use client";

/** Browser-side helper for calling /api/v1. Throws ApiError with a ready-to-show (translated) message. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function api<T = unknown>(url: string, opts: { method?: Method; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: opts.body === undefined ? undefined : { "content-type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(document.documentElement.lang === "hi" ? "सर्वर से संपर्क नहीं हो सका।" : "Could not reach the server.", 0, "network");
  }
  const payload = (await res.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string; fields?: Record<string, string> } }
    | null;
  if (res.status === 401 && !url.includes("/auth/")) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login?reason=timeout";
  }
  if (!payload) throw new ApiError("Unexpected response", res.status, "bad_response");
  if (!payload.ok) throw new ApiError(payload.error.message, res.status, payload.error.code, payload.error.fields);
  return payload.data;
}

/** Sends a multipart form (file uploads) to /api/v1 with the same errors as api(). */
export async function apiForm<T = unknown>(url: string, form: FormData, method: "POST" | "PUT" = "POST"): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, body: form, credentials: "same-origin" });
  } catch {
    throw new ApiError(document.documentElement.lang === "hi" ? "सर्वर से संपर्क नहीं हो सका।" : "Could not reach the server.", 0, "network");
  }
  const payload = (await res.json().catch(() => null)) as { ok: true; data: T } | { ok: false; error: { code: string; message: string; fields?: Record<string, string> } } | null;
  if (!payload) throw new ApiError("Unexpected response", res.status, "bad_response");
  if (!payload.ok) throw new ApiError(payload.error.message, res.status, payload.error.code, payload.error.fields);
  return payload.data;
}
