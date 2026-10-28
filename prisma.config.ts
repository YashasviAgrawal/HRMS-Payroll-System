import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // The CLI (migrations, seed) may need the direct address when DATABASE_URL goes through a pooler (Neon
    // "-pooler", Supabase port 6543); the app itself always uses DATABASE_URL (lib/db.ts).
    url: process.env["DIRECT_DATABASE_URL"] || process.env["DATABASE_URL"],
  },
});
