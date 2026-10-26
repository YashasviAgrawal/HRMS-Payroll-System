"use client";

import { ApiError } from "@/lib/http";

/** Sends a multipart form to /api/v1 and returns the data, with the same errors as `api`. */
export async function upload<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", body: form, credentials: "same-origin" });
  const payload = (await res.json().catch(() => null)) as { ok: boolean; data?: T; error?: { code: string; message: string; fields?: Record<string, string> } } | null;
  if (!payload) throw new ApiError("Unexpected response", res.status, "bad_response");
  if (!payload.ok) throw new ApiError(payload.error?.message ?? "Upload failed", res.status, payload.error?.code ?? "upload", payload.error?.fields);
  return payload.data as T;
}
