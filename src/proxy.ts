import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page request. Only cheap, optimistic work happens here (Next.js guidance):
 *  - pages without a session cookie go straight to sign-in (real checks happen in the layout/services);
 *  - the current path is passed to layouts so they can enforce "set your password first";
 * Security headers are set for every response in next.config.ts. API routes skip the proxy entirely so
 * uploads are streamed straight to the route handler.
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

  const headers = new Headers(request.headers);
  headers.set("x-pathname", pathname + search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|brand/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|woff2?)$).*)"],
};
