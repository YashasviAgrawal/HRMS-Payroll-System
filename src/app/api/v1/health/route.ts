import { db } from "@/lib/db";

/**
 * For the load balancer and monitoring: 200 when the app can reach its database, 503 when it cannot.
 * No sign-in needed and nothing about the installation is given away.
 */
export async function GET() {
  const headers = { "cache-control": "no-store" };
  try {
    await db.$queryRaw`select 1`;
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
