import "server-only";
import type { ApprovalTask, Prisma } from "@/generated/prisma/client";
import type { Permission } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/session";
import { db, type Tx } from "@/lib/db";
import { AppError, badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import type { TKey } from "@/lib/i18n";
import { emit } from "@/lib/outbox";
import { getApprovalKind } from "./registry";

export type Decision = "APPROVE" | "REJECT" | "RETURN";

export interface SubmitInput {
  kind: string;
  title: string;
  titleHi?: string;
  /** Rows shown to the checker: [{ label, old, new }] or any display data. */
  details?: unknown;
  payload: unknown;
  entityType: string;
  entityId?: string;
  subjectEmployeeId?: string | null;
  sectionId?: string | null;
  note?: string | null;
  /** Overrides the kind's default, for chains (Checker → Approver). */
  requiredPermission?: Permission;
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;

/** Puts an item into the approvals inbox. Call it inside the maker's transaction. */
export async function submitForApproval(tx: Tx, actor: Actor, input: SubmitInput): Promise<ApprovalTask> {
  const def = getApprovalKind(input.kind);
  if (!def) throw new Error(`Unknown approval kind ${input.kind}`);
  if (input.subjectEmployeeId && input.subjectEmployeeId === actor.employeeId && !def.allowSelfSubject) {
    throw forbidden("errors.ownPay");
  }
  const task = await tx.approvalTask.create({
    data: {
      boardId: actor.boardId,
      kind: input.kind,
      title: input.title,
      titleHi: input.titleHi ?? null,
      details: input.details === undefined ? undefined : json(input.details),
      payload: json(input.payload),
      requiredPermission: input.requiredPermission ?? def.requiredPermission,
      sectionId: input.sectionId ?? null,
      subjectEmployeeId: input.subjectEmployeeId ?? null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      makerId: actor.userId,
      makerName: actor.name,
      makerNote: input.note ?? null,
    },
  });
  await audit(tx, actor, {
    action: "SUBMIT",
    entityType: input.entityType,
    entityId: input.entityId,
    summary: `Sent for approval: ${input.title}`,
    newValue: { taskId: task.id, kind: input.kind },
    sensitive: def.sensitive,
  });
  return task;
}

/** Why this actor may not decide this task, or null when they may. */
export function decisionBlocker(actor: Actor, task: Pick<ApprovalTask, "requiredPermission" | "sectionId" | "makerId" | "subjectEmployeeId" | "status">): TKey | null {
  if (task.status !== "PENDING") return "errors.alreadyDecided";
  if (!actor.permissions.includes(task.requiredPermission)) return "errors.forbidden";
  if (task.requiredPermission === "REPORTING_OFFICER" && task.sectionId && task.sectionId !== actor.sectionId) {
    return "errors.forbidden";
  }
  // PRD §2 rule 1 — nobody approves their own entry.
  if (task.makerId === actor.userId) return "errors.ownEntry";
  // PRD §2 rule 2 — nobody processes their own pay, loan or arrears (or own record).
  if (task.subjectEmployeeId && task.subjectEmployeeId === actor.employeeId) return "errors.ownPay";
  return null;
}

export async function decide(actor: Actor, taskId: string, decision: Decision, note?: string | null) {
  const cleanNote = note?.trim() || null;
  if (decision !== "APPROVE" && !cleanNote) throw badRequest("errors.validation", { note: "approvals.noteRequired" });

  return db.$transaction(async (tx) => {
    const task = await tx.approvalTask.findFirst({ where: { id: taskId, boardId: actor.boardId } });
    if (!task) throw notFound();
    const blocker = decisionBlocker(actor, task);
    if (blocker) throw blocker === "errors.alreadyDecided" ? conflict(blocker) : forbidden(blocker);
    const def = getApprovalKind(task.kind);
    if (!def) throw new Error(`Unknown approval kind ${task.kind}`);

    const status = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "RETURNED";
    // Claim the task first; a second person deciding at the same moment gets "already decided".
    const claimed = await tx.approvalTask.updateMany({
      where: { id: task.id, status: "PENDING" },
      data: { status, deciderId: actor.userId, deciderName: actor.name, decisionNote: cleanNote, decidedAt: new Date() },
    });
    if (claimed.count !== 1) throw conflict("errors.alreadyDecided");

    const ctx = { tx, task, payload: task.payload as never, actor, note: cleanNote };
    if (decision === "APPROVE") await def.onApprove(ctx);
    else if (decision === "REJECT") await def.onReject?.(ctx);
    else await (def.onReturn ?? def.onReject)?.(ctx);

    await audit(tx, actor, {
      action: decision === "APPROVE" ? "APPROVE" : decision === "REJECT" ? "REJECT" : "RETURN",
      entityType: task.entityType,
      entityId: task.entityId,
      summary: `${status === "APPROVED" ? "Approved" : status === "REJECTED" ? "Rejected" : "Sent back"}: ${task.title}`,
      newValue: { taskId: task.id, kind: task.kind, note: cleanNote },
      sensitive: def.sensitive,
    });
    if (decision === "APPROVE") {
      await emit(tx, actor.boardId, `${task.kind}.approved`, { type: task.entityType, id: task.entityId ?? task.id }, { taskId: task.id });
    }
    return { ...task, status };
  });
}

/** Tasks this actor may decide. */
function inboxWhere(actor: Actor): Prisma.ApprovalTaskWhereInput {
  const perms = actor.permissions;
  const or: Prisma.ApprovalTaskWhereInput[] = perms
    .filter((p) => p !== "REPORTING_OFFICER")
    .map((p) => ({ requiredPermission: p }));
  if (perms.includes("REPORTING_OFFICER") && actor.sectionId) {
    or.push({ requiredPermission: "REPORTING_OFFICER", sectionId: actor.sectionId });
  }
  if (or.length === 0) return { id: "__none__" };
  return {
    boardId: actor.boardId,
    status: "PENDING",
    makerId: { not: actor.userId },
    OR: or,
    AND: actor.employeeId
      ? [{ OR: [{ subjectEmployeeId: null }, { subjectEmployeeId: { not: actor.employeeId } }] }]
      : [],
  };
}

export async function listInbox(actor: Actor, opts: { take?: number; kind?: string } = {}) {
  return db.approvalTask.findMany({
    where: { ...inboxWhere(actor), ...(opts.kind ? { kind: opts.kind } : {}) },
    orderBy: { createdAt: "asc" },
    take: opts.take ?? 200,
  });
}

export async function countInbox(actor: Actor) {
  return db.approvalTask.count({ where: inboxWhere(actor) });
}

export async function listRaisedBy(actor: Actor, take = 50) {
  return db.approvalTask.findMany({
    where: { boardId: actor.boardId, makerId: actor.userId },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function listDecidedBy(actor: Actor, take = 50) {
  return db.approvalTask.findMany({
    where: { boardId: actor.boardId, deciderId: actor.userId },
    orderBy: { decidedAt: "desc" },
    take,
  });
}

export async function getTask(actor: Actor, id: string) {
  const task = await db.approvalTask.findFirst({ where: { id, boardId: actor.boardId } });
  if (!task) throw notFound();
  const mayDecide = decisionBlocker(actor, task) === null;
  const isMaker = task.makerId === actor.userId;
  if (!mayDecide && !isMaker && task.deciderId !== actor.userId) {
    // Others may only see it if they could have decided it.
    if (!actor.permissions.includes(task.requiredPermission)) throw forbidden();
  }
  return { task, mayDecide };
}

export { AppError };
