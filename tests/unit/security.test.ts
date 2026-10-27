import { afterEach, describe, expect, it, vi } from "vitest";
import { contentSecurityPolicy } from "@/lib/csp";
import { hit, resetLimits } from "@/lib/rate-limit";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const { clientIp } = await import("@/lib/request-meta");

describe("Content Security Policy (§16 security)", () => {
  it("lets only this site's scripts carrying the nonce run, and never in a frame", () => {
    const csp = contentSecurityPolicy("abc123", { dev: false, https: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("allows eval only while developing, and does not upgrade requests on plain HTTP", () => {
    const csp = contentSecurityPolicy("n", { dev: true, https: false });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});

describe("rate limits", () => {
  afterEach(() => resetLimits());

  it("refuses the request over the limit with the seconds to wait, then opens again", () => {
    const rule = { max: 3, windowMs: 60_000 };
    const t0 = 1_000_000;
    expect(hit("k", rule, t0).ok).toBe(true);
    expect(hit("k", rule, t0 + 1).ok).toBe(true);
    expect(hit("k", rule, t0 + 2).ok).toBe(true);
    const fourth = hit("k", rule, t0 + 10_000);
    expect(fourth).toEqual({ ok: false, retryAfterS: 50 });
    expect(hit("other", rule, t0 + 10_000).ok).toBe(true);
    expect(hit("k", rule, t0 + 60_000).ok).toBe(true);
  });
});

describe("client address behind the Board's reverse proxy", () => {
  it("takes the address the trusted proxy added, not one the client typed", () => {
    expect(clientIp("6.6.6.6, 10.1.2.3", null, 1)).toBe("10.1.2.3");
    expect(clientIp("6.6.6.6, 10.1.2.3, 172.16.0.5", null, 2)).toBe("10.1.2.3");
    expect(clientIp("10.1.2.3", null, 3)).toBe("10.1.2.3");
    expect(clientIp(null, "10.9.9.9", 1)).toBe("10.9.9.9");
    expect(clientIp("6.6.6.6", "10.9.9.9", 0)).toBeNull();
  });
});
