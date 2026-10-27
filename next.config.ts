import type { NextConfig } from "next";

// Sent with every response. The Content Security Policy (with a fresh nonce) and HSTS are added to
// pages by src/proxy.ts, because they depend on the request and on whether the site runs on HTTPS.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Chromium (PDFs) and Excel parsing stay as plain Node modules on the server.
  serverExternalPackages: ["playwright-core", "exceljs"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
