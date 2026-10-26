import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page request. Only cheap, optimistic work happens here (Next.js guidance):
 *  - pages without a session cookie go straight to sign-in (real checks happen in the layout/services);
 *  - the current path is passed to layouts so they can enforce "set your password first";
 *  - security headers are added to every response.
 */
const PUBLIC_PATHS = ["/login"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSession = request.cookies.has("dcb_session");

  if (!isPublic && !hasSession && !pathname.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const headers = new Headers(request.headers);
  headers.set("x-pathname", pathname + search);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|woff2?)$).*)"],
};
