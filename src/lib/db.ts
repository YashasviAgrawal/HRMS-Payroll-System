import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function client(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const adapter = new PrismaPg({ connectionString: env().DATABASE_URL });
    globalForPrisma.prisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.prisma;
}

/**
 * The database client, created on first use (not at import) so that building the app never needs a
 * database or secrets. One client is shared per process.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client();
    const value = Reflect.get(c, prop, c);
    return typeof value === "function" ? value.bind(c) : value;
  },
});

/** The transaction client handed to callbacks of db.$transaction. */
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
/** Either the root client or a transaction — services accept both so they can be composed. */
export type DbLike = PrismaClient | Tx;
