/**
 * Brings an existing demo or training copy up to date with the client add-ons, without touching what is there:
 * the DA history and any new pay heads and rates (added only where missing), and the demo leaver for the full and
 * final settlement. Run once after deploying, with the copy's database address:
 *   DATABASE_URL="<url>" npm run db:demo-addons
 * Refuses to run on a production copy (APP_ENV=production).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedDemoLeaver } from "../prisma/seed-addons";
import { seedPayrollRules } from "../prisma/seed-payroll";

async function main() {
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
    console.log(`Demo leaver (Vikas Malhotra, DCB10012): ${await seedDemoLeaver(db, board.id)}.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
