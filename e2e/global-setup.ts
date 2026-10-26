import "dotenv/config";
import pg from "pg";

/**
 * Browser checks sign in many times; clear OTP history and password lockouts on the local demo database
 * first so the (deliberate) rate limits do not get in the way. Never runs against a remote site.
 */
export default async function globalSetup() {
  const base = process.env.BASE_URL ?? "http://localhost:3000";
  if (!/localhost|127\.0\.0\.1/.test(base) || !process.env.DATABASE_URL) return;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('DELETE FROM "OtpChallenge"');
  await client.query('UPDATE "User" SET "failedLoginCount" = 0, "lockedUntil" = NULL');
  await client.end();
}
