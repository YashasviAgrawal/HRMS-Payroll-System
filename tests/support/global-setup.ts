import { execSync } from "node:child_process";
import "dotenv/config";
import pg from "pg";

/**
 * Integration tests run against TEST_DATABASE_URL, rebuilt from the migrations on every run so the
 * schema under test is exactly what production gets.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn("TEST_DATABASE_URL not set — integration tests will be skipped.");
    return;
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await client.end();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
