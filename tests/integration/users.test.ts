import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUser, updateUser } from "@/modules/users/service";
import { listAudit } from "@/modules/audit/service";
import { actorFor, hasTestDb, makeBoard, makeEmployee, makeUser } from "../support/factory";

describe.skipIf(!hasTestDb)("users and permissions (S-80)", () => {
  let boardId: string;
  beforeAll(async () => {
    boardId = (await makeBoard()).id;
  });

  it("only the User & settings manager creates users", async () => {
    const approver = await actorFor((await makeUser(boardId, "ADMIN", ["APPROVER"])).id);
    await expect(
      createUser(approver, { loginType: "HR_ACCOUNTS", loginId: "NEWHR1", displayName: "New HR", mobile: "9876500001", permissions: ["HR"], temporaryPassword: "Temp12345" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("checks permissions belong to the login and blocks the settings-manager conflict", async () => {
    const mgr = await actorFor((await makeUser(boardId, "ADMIN", ["USER_SETTINGS_MANAGER"])).id);
    await expect(
      createUser(mgr, { loginType: "HR_ACCOUNTS", loginId: "BADPERM1", displayName: "X", mobile: "9876500002", permissions: ["APPROVER"], temporaryPassword: "Temp12345" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createUser(mgr, { loginType: "ADMIN", loginId: "BADPERM2", displayName: "X", mobile: "9876500003", permissions: ["USER_SETTINGS_MANAGER", "APPROVER"], temporaryPassword: "Temp12345" }),
    ).rejects.toMatchObject({ key: "users.conflict" });
  });

  it("creates an employee login linked to the record, blocks duplicates and audits as a system event", async () => {
    const mgr = await actorFor((await makeUser(boardId, "ADMIN", ["USER_SETTINGS_MANAGER"])).id);
    const emp = await makeEmployee(boardId);
    const user = await createUser(mgr, { loginType: "EMPLOYEE", loginId: emp.employeeCode, displayName: "Staff", mobile: "9876500004", employeeId: emp.id, permissions: ["REPORTING_OFFICER"] });
    expect(user.permissions).toEqual(["REPORTING_OFFICER"]);
    await expect(
      createUser(mgr, { loginType: "EMPLOYEE", loginId: "OTHER123", displayName: "Dup", mobile: "9876500004", employeeId: (await makeEmployee(boardId)).id, permissions: [] }),
    ).rejects.toMatchObject({ status: 409 });
    const log = await listAudit(mgr, { entityId: user.id });
    expect(log.systemOnly).toBe(true);
    expect(log.rows[0]?.summary).toContain("Created EMPLOYEE login");
    expect(JSON.stringify(log.rows[0]?.newValue)).not.toContain("9876500004");
  });

  it("nobody changes their own permissions", async () => {
    const me = await makeUser(boardId, "ADMIN", ["USER_SETTINGS_MANAGER"]);
    const actor = await actorFor(me.id);
    await expect(updateUser(actor, me.id, { displayName: me.displayName, mobile: me.mobile, permissions: [] })).rejects.toMatchObject({ status: 403 });
    // Editing own name without touching permissions is fine.
    await expect(updateUser(actor, me.id, { displayName: "Renamed", mobile: me.mobile, permissions: ["USER_SETTINGS_MANAGER"] })).resolves.toMatchObject({ displayName: "Renamed" });
  });

  it("the settings manager sees only system events in the audit trail", async () => {
    const mgr = await actorFor((await makeUser(boardId, "ADMIN", ["USER_SETTINGS_MANAGER"])).id);
    await db.auditLog.create({ data: { boardId, action: "UPDATE", entityType: "Employee", summary: "Bank changed", category: "DATA", isSensitive: true, oldValue: { bank: "XXXX1234" } } });
    const log = await listAudit(mgr, { q: "Bank changed" });
    expect(log.rows).toHaveLength(0);
    const approver = await actorFor((await makeUser(boardId, "ADMIN", ["APPROVER"])).id);
    expect((await listAudit(approver, { q: "Bank changed" })).rows).toHaveLength(1);
  });
});
