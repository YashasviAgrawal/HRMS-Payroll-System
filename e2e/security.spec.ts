import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/** PRD §16 security: protective headers on every screen, no caching of personal data, a strict script policy. */
test("screens carry the security headers and a fresh script nonce on every request", async ({ page, request }) => {
  const first = await request.get("/login");
  const headers = first.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["x-powered-by"]).toBeUndefined();

  const csp = headers["content-security-policy"];
  const nonce = csp.match(/'nonce-([^']+)'/)![1];
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
  // Next.js puts the nonce on its own scripts; nothing runs without it.
  const html = await first.text();
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);

  const second = await request.get("/login");
  expect(second.headers()["content-security-policy"]).not.toContain(nonce);

  // The screen still works under the policy: sign in and read personal data through the API.
  await signIn(page, { as: "Employee / Pensioner", id: "DCB10014" });
  const me = await page.request.get("/api/v1/auth/session");
  expect(me.headers()["cache-control"]).toBe("no-store");
});

test("the health check answers without signing in and gives nothing away", async ({ request }) => {
  const res = await request.get("/api/v1/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(res.headers()["cache-control"]).toBe("no-store");
});
