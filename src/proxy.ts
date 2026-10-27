import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, HSTS } from "@/lib/csp";

/**
 * Runs before every page request. Only cheap, optimistic work happens here (Next.js guidance):
 *  - pages without a session cookie go straight to sign-in (real checks happen in the layout/services);
 *  - the current path is passed to layouts so they can enforce "set your password first";
 *  - each page gets a fresh nonce and its Content Security Policy (Next.js puts the nonce on its own
 *    scripts), and HSTS when served over HTTPS.
 * The other security headers are set for every response in next.config.ts. API routes skip the proxy
 * entirely so uploads are streamed straight to the route handler.
 */
const PUBLIC_PATHS = ["/login"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSession = request.cookies.has("dcb_session");

  if (!isPublic && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const https = (process.env.APP_URL ?? "").startsWith("https://");
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, { dev: process.env.NODE_ENV === "development", https });

  const headers = new Headers(request.headers);
  headers.set("x-pathname", pathname + search);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  if (https) response.headers.set("Strict-Transport-Security", HSTS);
  return response;
}

export const config = {
  matcher: ["/((?!api/|iclock/|_next/static|_next/image|brand/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|woff2?)$).*)"],
};
