import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { countInbox, decide, listInbox, submitForApproval } from "@/lib/approvals/engine";
import { defineApprovalKind } from "@/lib/approvals/registry";
import { actorFor, hasTestDb, makeBoard, makeEmployee, makeSection, makeUser } from "../support/factory";

const applied: string[] = [];

defineApprovalKind<{ value: string }>({
  kind: "test.change",
  requiredPermission: "CHECKER",
  async onApprove({ payload }) {
    applied.push(payload.value);
  },
});
defineApprovalKind<{ value: string }>({
  kind: "test.section",
  requiredPermission: "REPORTING_OFFICER",
  allowSelfSubject: true,
  async onApprove({ payload }) {
    applied.push(payload.value);
  },
});

describe.skipIf(!hasTestDb)("maker-checker engine (PRD §2 rules 1 and 2)", () => {
  let boardId: string;
  beforeAll(async () => {
    boardId = (await makeBoard()).id;
  });

  async function submit(makerId: string, kind = "test.change", extra: { subjectEmployeeId?: string; sectionId?: string } = {}) {
    const maker = await actorFor(makerId);
    return db.$transaction((tx) => submitForApproval(tx, maker, { kind, title: "Test change", payload: { value: `v-${Date.now()}` }, entityType: "Test", ...extra }));
  }

  it("nobody approves their own entry", async () => {
    const both = await makeUser(boardId, "HR_ACCOUNTS", ["HR", "CHECKER"]);
    const task = await submit(both.id);
    const me = await actorFor(both.id);
    expect((await listInbox(me)).find((t) => t.id === task.id)).toBeUndefined();
    await expect(decide(me, task.id, "APPROVE")).rejects.toMatchObject({ key: "errors.ownEntry" });
  });

  it("nobody processes their own pay or record", async () => {
    const emp = await makeEmployee(boardId);
    const checker = await makeUser(boardId, "HR_ACCOUNTS", ["CHECKER"], emp.id);
    const maker = await makeUser(boardId, "HR_ACCOUNTS", ["HR"]);
    const task = await submit(maker.id, "test.change", { subjectEmployeeId: emp.id });
    const checkerActor = await actorFor(checker.id);
    expect((await listInbox(checkerActor)).find((t) => t.id === task.id)).toBeUndefined();
    await expect(decide(checkerActor, task.id, "APPROVE")).rejects.toMatchObject({ key: "errors.ownPay" });

    // …and an HR user cannot even raise a change about themselves.
    const hrEmp = await makeEmployee(boardId);
    const selfMaker = await makeUser(boardId, "HR_ACCOUNTS", ["HR"], hrEmp.id);
    await expect(submit(selfMaker.id, "test.change", { subjectEmployeeId: hrEmp.id })).rejects.toMatchObject({ key: "errors.ownPay" });
  });

  it("a different checker approves; the change is applied, audited and sent to the outbox", async () => {
    const maker = await makeUser(boardId, "HR_ACCOUNTS", ["HR"]);
    const checker = await makeUser(boardId, "HR_ACCOUNTS", ["CHECKER"]);
    const task = await submit(maker.id);
    const checkerActor = await actorFor(checker.id);
    expect(await countInbox(checkerActor)).toBeGreaterThan(0);
    await decide(checkerActor, task.id, "APPROVE");
    expect(applied).toContain((task.payload as { value: string }).value);
    const saved = await db.approvalTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(saved.status).toBe("APPROVED");
    expect(saved.deciderId).toBe(checker.id);
    expect(await db.auditLog.count({ where: { action: "APPROVE", newValue: { path: ["taskId"], equals: task.id } } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { eventType: "test.change.approved", payload: { path: ["taskId"], equals: task.id } } })).toBe(1);
    // A second decision is refused.
    const other = await makeUser(boardId, "HR_ACCOUNTS", ["CHECKER"]);
    await expect(decide(await actorFor(other.id), task.id, "REJECT", "late")).rejects.toMatchObject({ key: "errors.alreadyDecided" });
  });

  it("rejecting or sending back needs a reason", async () => {
    const maker = await makeUser(boardId, "HR_ACCOUNTS", ["HR"]);
    const checker = await makeUser(boardId, "HR_ACCOUNTS", ["CHECKER"]);
    const task = await submit(maker.id);
    await expect(decide(await actorFor(checker.id), task.id, "REJECT", "  ")).rejects.toMatchObject({ status: 400 });
    await decide(await actorFor(checker.id), task.id, "RETURN", "Please attach the order");
    expect((await db.approvalTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("RETURNED");
  });

  it("reporting officers decide only for their own section (rule 5)", async () => {
    const sectionA = await makeSection(boardId);
    const sectionB = await makeSection(boardId);
    const headA = await makeUser(boardId, "EMPLOYEE", ["REPORTING_OFFICER"], (await makeEmployee(boardId, { sectionId: sectionA.id })).id);
    const headB = await makeUser(boardId, "EMPLOYEE", ["REPORTING_OFFICER"], (await makeEmployee(boardId, { sectionId: sectionB.id })).id);
    const staffEmp = await makeEmployee(boardId, { sectionId: sectionA.id });
    const staff = await makeUser(boardId, "EMPLOYEE", [], staffEmp.id);
    const task = await submit(staff.id, "test.section", { subjectEmployeeId: staffEmp.id, sectionId: sectionA.id });
    const b = await actorFor(headB.id);
    expect((await listInbox(b)).find((t) => t.id === task.id)).toBeUndefined();
    await expect(decide(b, task.id, "APPROVE")).rejects.toMatchObject({ status: 403 });
    await decide(await actorFor(headA.id), task.id, "APPROVE");
    expect((await db.approvalTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("APPROVED");
  });
});
