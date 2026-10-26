import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import pg from "pg";

/**
 * Rebuilds the browser-check database from the migrations and loads the demo seed, so every run starts from
 * the same state. When pointed at an external BASE_URL, only OTP history and lockouts are cleared.
 */
export default async function globalSetup() {
  // Saved sessions belong to the previous run's database.
  fs.rmSync(path.join(__dirname, "..", "test-results", ".sessions"), { recursive: true, force: true });
  if (process.env.BASE_URL) {
    if (!/localhost|127\.0\.0\.1/.test(process.env.BASE_URL) || !process.env.DATABASE_URL) return;
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query('DELETE FROM "OtpChallenge"');
    await client.query('UPDATE "User" SET "failedLoginCount" = 0, "lockedUntil" = NULL');
    await client.end();
    return;
  }
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("Set E2E_DATABASE_URL (a throw-away database) or BASE_URL.");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await client.end();
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}
