import "server-only";
import { headers } from "next/headers";

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/** Client IP (first hop of X-Forwarded-For behind the government load balancer) and browser. */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip") || null;
  const userAgent = h.get("user-agent")?.slice(0, 300) ?? null;
  return { ip, userAgent };
}
