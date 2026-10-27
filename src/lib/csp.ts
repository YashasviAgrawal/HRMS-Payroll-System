/**
 * Content Security Policy for the screens (PRD §16 security; Next.js nonce guide). Scripts run only from
 * this site with the per-request nonce the proxy makes, so an injected <script> or event handler never
 * runs. Styles allow inline `style` attributes (bar widths, grid columns) — they cannot run code.
 */
export function contentSecurityPolicy(nonce: string, { dev, https }: { dev: boolean; https: boolean }): string {
  return [
    "default-src 'self'",
    // React rebuilds server error stacks with eval in development only.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** Sent with every page served over HTTPS: the browser refuses plain HTTP for two years. */
export const HSTS = "max-age=63072000; includeSubDomains";
