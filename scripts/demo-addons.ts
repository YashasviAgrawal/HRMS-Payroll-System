/**
 * Brings an existing demo or training copy up to date with the client add-ons, without touching what is there:
 * the DA history and any new pay heads and rates (added only where missing), and the demo leaver for the full and
 * final settlement. Run once after deploying, with the copy's database address:
 *   DATABASE_URL="<url>" npm run db:demo-addons
 * Refuses to run on a production copy (APP_ENV=production).
 *
 * `--training-build` (Vercel's build): runs only on a training copy (APP_ENV=training) and never fails the build —
 * anything else is skipped with a line in the build log.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedDemoLeaver } from "../prisma/seed-addons";
import { seedPayrollRules } from "../prisma/seed-payroll";

const inBuild = process.argv.includes("--training-build");

async function main() {
  if (inBuild && process.env.APP_ENV !== "training") return console.log("Demo data for new features: skipped (not a training copy).");
  if (process.env.APP_ENV === "production") throw new Error("This adds demo data; it never runs on a production copy.");
  const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to the demo copy's database.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const board = await db.board.findUnique({ where: { code: process.env.BOARD_CODE ?? "DCB" } });
    if (!board) throw new Error("No Board in this database — run the seed first.");
    const before = await db.payRate.count({ where: { boardId: board.id } });
    await seedPayrollRules(db, board.id);
    const after = await db.payRate.count({ where: { boardId: board.id } });
    console.log(`Rates and pay heads: ${after - before} new rate rows (existing ones left as they were).`);
    const leaver = await seedDemoLeaver(db, board.id);
    console.log(`Demo leaver (Vikas Malhotra, DCB10012): ${leaver}${leaver === "skipped" ? " — not on the rolls, already has a suspension or leaving recorded, or the HR login DCB10003 is missing" : ""}.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  if (!inBuild) process.exit(1);
});
