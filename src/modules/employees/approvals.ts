import "server-only";
import { chainTask } from "@/lib/approvals/engine";
import { defineApprovalKind } from "@/lib/approvals/registry";
import { audit } from "@/lib/audit";
import { emit } from "@/lib/outbox";
import { fullName } from "./present";
import { replaceFamily } from "./records";
import type { FamilyInput } from "./schema";
import { applyEmployeeChange, nextEmployeeCode } from "./service";

type Change = { field: string; old: string | null; new: string | null; sensitive: boolean };

/** New employee: the Checker's approval issues the Employee ID and puts the person on the rolls (RO flow step 4). */
defineApprovalKind<{ employeeId: string }>({
  kind: "employee.create",
  requiredPermission: "CHECKER",
  sensitive: true,
  async onApprove({ tx, payload, actor }) {
    const e = await tx.employee.findUniqueOrThrow({ where: { id: payload.employeeId } });
    const code = e.employeeCode ?? (await nextEmployeeCode(tx, e.boardId));
    await tx.employee.update({ where: { id: e.id }, data: { status: "ACTIVE", employeeCode: code } });
    await tx.employeeFieldHistory.create({
      data: { employeeId: e.id, field: "employeeCode", oldValue: null, newValue: code, approvedById: actor.userId, approvedBy: actor.name },
    });
    await audit(tx, actor, { action: "ISSUE_ID", entityType: "Employee", entityId: e.id, summary: `Employee ID ${code} issued to ${fullName(e)}` });
    await emit(tx, e.boardId, "employee.created", { type: "Employee", id: e.id }, { employeeCode: code });
  },
});

/** Bulk upload (EM-10): one approval issues IDs to every draft in the batch. */
defineApprovalKind<{ employeeIds: string[] }>({
  kind: "employee.bulk_create",
  requiredPermission: "CHECKER",
  sensitive: true,
  async onApprove({ tx, payload, actor }) {
    for (const id of payload.employeeIds) {
      const e = await tx.employee.findUnique({ where: { id } });
      if (!e || e.status !== "DRAFT") continue;
      const code = e.employeeCode ?? (await nextEmployeeCode(tx, e.boardId));
      await tx.employee.update({ where: { id }, data: { status: "ACTIVE", employeeCode: code } });
      await emit(tx, e.boardId, "employee.created", { type: "Employee", id }, { employeeCode: code, bulk: true });
    }
    await audit(tx, actor, { action: "ISSUE_ID", entityType: "Employee", summary: `Approved bulk upload of ${payload.employeeIds.length} employees` });
  },
  async onReject({ tx, payload }) {
    // Rejected drafts are removed so the corrected file can be uploaded again.
    await tx.employee.deleteMany({ where: { id: { in: payload.employeeIds }, status: "DRAFT" } });
  },
});

/** EM-07: a change made by HR applies only when a Checker approves it. */
defineApprovalKind<{ employeeId: string; data: Record<string, unknown>; history: Change[] }>({
  kind: "employee.update",
  requiredPermission: "CHECKER",
  sensitive: true,
  async onApprove({ tx, task, payload, actor }) {
    await applyEmployeeChange(tx, actor, task, payload.employeeId, payload.data, payload.history);
    await emit(tx, task.boardId, "employee.updated", { type: "Employee", id: payload.employeeId }, { fields: payload.history.map((h) => h.field) });
  },
});

defineApprovalKind<{ employeeId: string; input: FamilyInput }>({
  kind: "employee.family",
  requiredPermission: "CHECKER",
  async onApprove({ tx, payload, actor }) {
    await replaceFamily(tx, payload.employeeId, payload.input);
    await tx.employeeFieldHistory.create({
      data: {
        employeeId: payload.employeeId,
        field: "family",
        newValue: `${payload.input.members.length} members, ${payload.input.nominees.length} nominations`,
        approvedById: actor.userId,
        approvedBy: actor.name,
      },
    });
  },
});

/**
 * EM-08: employee asks; HR approves. A bank change then also needs a Checker before salary goes to it (EM-07),
 * so HR's approval opens a Checker step instead of applying it.
 */
defineApprovalKind<{ kind: "address" | "mobile" | "bank" | "nominee"; employeeId: string; data: Record<string, unknown>; history: Change[] }>({
  kind: "employee.self_request",
  requiredPermission: "HR",
  allowSelfSubject: true,
  sensitive: true,
  async onApprove({ tx, task, payload, actor }) {
    if (payload.kind === "nominee") return; // HR now records the new nomination through the family screen.
    if (payload.kind === "bank") {
      await chainTask(tx, task, {
        kind: "employee.update",
        requiredPermission: "CHECKER",
        makerId: actor.userId,
        makerName: actor.name,
        payload: { employeeId: payload.employeeId, data: payload.data, history: payload.history },
      });
      return;
    }
    await applyEmployeeChange(tx, actor, task, payload.employeeId, payload.data, payload.history);
    if (payload.kind === "mobile") {
      // Every login of the person moves to the new number.
      await tx.user.updateMany({ where: { employeeId: payload.employeeId }, data: { mobile: String(payload.data.mobile) } });
    }
  },
});

/** Service book: Checker; appointment / promotion / penalty also need an Admin Approver (§14). */
defineApprovalKind<{ entryId: string; needsApprover: boolean; step?: "approver" }>({
  kind: "service_book.entry",
  requiredPermission: "CHECKER",
  async onApprove({ tx, task, payload, actor }) {
    if (payload.needsApprover && payload.step !== "approver") {
      await chainTask(tx, task, { requiredPermission: "APPROVER", payload: { ...payload, step: "approver" } });
      return;
    }
    const entry = await tx.serviceBookEntry.update({ where: { id: payload.entryId }, data: { status: "APPROVED", approvedById: actor.userId } });
    await emit(tx, task.boardId, "service_book.recorded", { type: "Employee", id: entry.employeeId }, { event: entry.event, entryId: entry.id });
  },
  async onReject({ tx, payload }) {
    await tx.serviceBookEntry.update({ where: { id: payload.entryId }, data: { status: "REJECTED" } });
  },
  async onCancel({ tx, payload }) {
    await tx.serviceBookEntry.update({ where: { id: payload.entryId }, data: { status: "REJECTED" } });
  },
});

defineApprovalKind<{ rows: { sectionId: string; postId: string; sanctioned: number; old: number }[]; orderRef: string | null }>({
  kind: "sanctioned.update",
  requiredPermission: "CHECKER",
  async onApprove({ tx, task, payload, actor }) {
    for (const r of payload.rows) {
      await tx.sanctionedPost.upsert({
        where: { boardId_sectionId_postId: { boardId: task.boardId, sectionId: r.sectionId, postId: r.postId } },
        create: { boardId: task.boardId, sectionId: r.sectionId, postId: r.postId, sanctioned: r.sanctioned, orderRef: payload.orderRef, updatedById: actor.userId },
        update: { sanctioned: r.sanctioned, orderRef: payload.orderRef, updatedById: actor.userId },
      });
    }
    await audit(tx, actor, {
      action: "UPDATE",
      entityType: "SanctionedPost",
      summary: `Sanctioned strength changed for ${payload.rows.length} posts`,
      oldValue: Object.fromEntries(payload.rows.map((r) => [`${r.sectionId}:${r.postId}`, r.old])),
      newValue: Object.fromEntries(payload.rows.map((r) => [`${r.sectionId}:${r.postId}`, r.sanctioned])),
    });
  },
});
