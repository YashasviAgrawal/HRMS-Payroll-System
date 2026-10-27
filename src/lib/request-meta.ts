import "server-only";
import { headers } from "next/headers";
import { env } from "@/lib/env";

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/**
 * The client's address as the Board's own reverse proxy saw it. Each trusted proxy adds the address it
 * received the request from to the end of X-Forwarded-For, so the real client is TRUSTED_PROXY_HOPS
 * places from the right; anything further left was typed by the client and is ignored (audit trail and
 * rate limits must not be fooled by a made-up header).
 */
export function clientIp(forwardedFor: string | null, realIp: string | null, hops: number): string | null {
  if (hops <= 0) return null;
  const chain = (forwardedFor ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (chain.length) return chain[Math.max(0, chain.length - hops)];
  return realIp?.trim() || null;
}

export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const ip = clientIp(h.get("x-forwarded-for"), h.get("x-real-ip"), env().TRUSTED_PROXY_HOPS);
  const userAgent = h.get("user-agent")?.slice(0, 300) ?? null;
  return { ip: ip?.slice(0, 64) ?? null, userAgent };
}
