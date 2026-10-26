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

/**
 * Every module's approval kinds must be registered before an item is submitted or decided, whichever
 * route got us here. A dynamic import avoids a static import cycle (modules import this engine too).
 */
let kindsLoaded: Promise<unknown> | undefined;
async function loadKinds() {
  kindsLoaded ??= import("./kinds");
  await kindsLoaded;
}

/** Puts an item into the approvals inbox. Call it inside the maker's transaction. */
export async function submitForApproval(tx: Tx, actor: Actor, input: SubmitInput): Promise<ApprovalTask> {
  await loadKinds();
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

/**
 * Creates the next step of a chain (e.g. Checker → Approver) from inside a decision. The maker stays the
 * original maker, so the "nobody approves their own entry" rule still holds at every step.
 */
export async function chainTask(
  tx: Tx,
  from: ApprovalTask,
  next: { kind?: string; requiredPermission: Permission; title?: string; titleHi?: string; payload?: unknown; details?: unknown; makerId?: string; makerName?: string },
) {
  return tx.approvalTask.create({
    data: {
      boardId: from.boardId,
      kind: next.kind ?? from.kind,
      title: next.title ?? from.title,
      titleHi: next.titleHi ?? from.titleHi,
      details: next.details === undefined ? (from.details ?? undefined) : json(next.details),
      payload: json({ ...(next.payload === undefined ? (from.payload as object) : (next.payload as object)), parentTaskId: from.id }),
      requiredPermission: next.requiredPermission,
      sectionId: from.sectionId,
      subjectEmployeeId: from.subjectEmployeeId,
      entityType: from.entityType,
      entityId: from.entityId,
      makerId: next.makerId ?? from.makerId,
      makerName: next.makerName ?? from.makerName,
      makerNote: from.makerNote,
    },
  });
}

/** The maker withdraws an item that nobody has decided yet. */
export async function cancelTask(actor: Actor, taskId: string) {
  await loadKinds();
  return db.$transaction(async (tx) => {
    const task = await tx.approvalTask.findFirst({ where: { id: taskId, boardId: actor.boardId } });
    if (!task) throw notFound();
    if (task.makerId !== actor.userId) throw forbidden();
    const res = await tx.approvalTask.updateMany({ where: { id: taskId, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date() } });
    if (res.count !== 1) throw conflict("errors.alreadyDecided");
    const def = getApprovalKind(task.kind);
    await def?.onCancel?.({ tx, task, payload: task.payload as never, actor, note: null });
    await audit(tx, actor, { action: "CANCEL", entityType: task.entityType, entityId: task.entityId, summary: `Withdrew: ${task.title}` });
  });
}

/** Pending tasks about one record (to show "waiting for check" on a screen, or to stop a second change). */
export async function pendingFor(boardId: string, entityType: string, entityId: string, kinds?: string[], db_: Tx | typeof db = db) {
  return db_.approvalTask.findMany({
    where: { boardId, entityType, entityId, status: "PENDING", ...(kinds ? { kind: { in: kinds } } : {}) },
    orderBy: { createdAt: "asc" },
  });
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
  await loadKinds();

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
