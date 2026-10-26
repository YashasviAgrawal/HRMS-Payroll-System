import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hasTestDb, makeBoard } from "../support/factory";

describe.skipIf(!hasTestDb)("audit trail cannot be edited (PRD §16)", () => {
  it("rejects UPDATE, DELETE and TRUNCATE", async () => {
    const board = await makeBoard();
    await audit(db, { boardId: board.id, name: "tester" }, { action: "CREATE", entityType: "ImmutableCheck", summary: "row" });
    const row = await db.auditLog.findFirstOrThrow({ where: { boardId: board.id, entityType: "ImmutableCheck" } });
    await expect(db.auditLog.update({ where: { id: row.id }, data: { summary: "changed" } })).rejects.toThrow();
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(db.$executeRawUnsafe('TRUNCATE "AuditLog"')).rejects.toThrow();
    const again = await db.auditLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(again.summary).toBe("row");
  });
});
