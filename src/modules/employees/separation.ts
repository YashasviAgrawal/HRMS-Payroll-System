import "server-only";
import { z } from "zod";
import type { ApprovalTask } from "@/generated/prisma/client";
import { submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db, type Tx } from "@/lib/db";
import { addDays, formatDate, fromISODate, todayIST, toISODate, type ISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { emit } from "@/lib/outbox";
import { isoDateField } from "@/lib/validators";
import { isExit, SEPARATION_KINDS, STATUS_AFTER, type SeparationKind } from "@/modules/payroll/settlement-rules";
import { fullName } from "./present";
import { canViewEmployee } from "./service";

/**
 * Client add-on: suspension and leaving service other than retirement or death (resignation, removal, dismissal,
 * termination, end of contract, transfer out). HR records it with the order; a Checker checks and an Admin approves
 * (as for a penalty in the service book, §14). Approval puts the person under suspension, or sets the last day — pay
 * stops after it and they leave the rolls the next day. A suspension ends by reinstatement (same two steps) or by
 * leaving service. The full and final settlement that follows is the payroll module's (payroll/settlement.ts).
 */
export const KIND_LABEL: Record<SeparationKind, [string, string]> = {
  SUSPENSION: ["Suspension", "निलंबन"],
  RESIGNATION: ["Resignation", "त्यागपत्र"],
  REMOVAL: ["Removal from service", "सेवा से हटाया जाना"],
  DISMISSAL: ["Dismissal from service", "सेवा से बर्खास्तगी"],
  TERMINATION: ["Termination of service", "सेवा समाप्ति"],
  CONTRACT_END: ["End of contract", "अनुबंध की समाप्ति"],
  TRANSFER_OUT: ["Transfer to another office", "अन्य कार्यालय में स्थानांतरण"],
};
const label = (k: string, lang: "en" | "hi" = "en") => KIND_LABEL[k as SeparationKind]?.[lang === "hi" ? 1 : 0] ?? k;

/** HR records; anyone who can see the employee master sees the list. */
export const canRecordSeparation = (actor: Actor) => canAll(actor, "service_book", "create");
export const canSeeSeparations = (actor: Actor) => canAll(actor, "employee_master", "view");

const CURRENT = ["ACTIVE", "SUSPENDED"] as const;
/** The last day may be set up to three months ahead (notice of resignation). */
const MAX_DAYS_AHEAD = 92;

export const separationSchema = z.object({
  kind: z.enum(SEPARATION_KINDS),
  effectiveDate: isoDateField,
  orderNumber: z.string().trim().min(2, "validation.tooShort").max(80),
  orderDate: isoDateField,
  reason: z.string().trim().min(3, "validation.tooShort").max(500),
  documentId: z.string().nullable().optional(),
});

export const reinstateSchema = z.object({
  /** The first day back on duty. */
  reinstatedOn: isoDateField,
  orderNumber: z.string().trim().min(2, "validation.tooShort").max(80),
  orderDate: isoDateField,
  note: z.string().trim().min(3, "validation.tooShort").max(500),
});

const fail = (field: string, key: string): never => {
  throw badRequest("errors.validation", { [field]: key });
};

async function checkDocument(employeeId: string, documentId: string | null | undefined) {
  if (!documentId) return null;
  const d = await db.employeeDocument.findFirst({ where: { id: documentId, employeeId }, select: { id: true } });
  if (!d) fail("documentId", "validation.invalid");
  return documentId;
}

/** HR records a suspension or the person leaving service; it waits for a Checker and an Admin. */
export async function proposeSeparation(actor: Actor, employeeId: string, raw: unknown) {
  if (!canRecordSeparation(actor)) throw forbidden();
  const input = separationSchema.parse(raw);
  const e = await db.employee.findFirst({ where: { id: employeeId, boardId: actor.boardId } });
  if (!e || !canViewEmployee(actor, e)) throw notFound();
  if (e.id === actor.employeeId) throw forbidden("errors.ownPay");
  const today = todayIST();
  if (input.kind === "SUSPENSION") {
    if (e.status === "SUSPENDED") fail("kind", "employees.exit.errors.alreadySuspended");
    if (e.status !== "ACTIVE") fail("kind", "employees.errors.notCurrent");
    if (input.effectiveDate > today) fail("effectiveDate", "employees.exit.errors.suspensionFuture");
  } else {
    if (!(CURRENT as readonly string[]).includes(e.status)) fail("kind", "employees.errors.notCurrent");
    if (input.effectiveDate > addDays(today, MAX_DAYS_AHEAD)) fail("effectiveDate", "employees.exit.errors.tooFar");
    // Someone who reaches retirement first retires (the pension case), not this flow.
    if (e.dateOfRetirement && input.effectiveDate >= toISODate(e.dateOfRetirement)) fail("effectiveDate", "employees.exit.errors.afterRetirement");
  }
  if (input.effectiveDate < toISODate(e.dateOfJoining)) fail("effectiveDate", "employees.exit.errors.beforeJoining");
  if (input.orderDate > today) fail("orderDate", "employees.exit.errors.orderFuture");
  const documentId = await checkDocument(e.id, input.documentId);
  if (e.status === "SUSPENDED") {
    const s = await db.separation.findFirst({ where: { employeeId: e.id, kind: "SUSPENSION", status: "APPROVED" } });
    if (s && input.effectiveDate < toISODate(s.effectiveDate)) fail("effectiveDate", "employees.exit.errors.beforeSuspension");
  }
  const rows: NonNullable<ApprovalDetails["rows"]> = [
    { label: "Employee", labelHi: "कर्मचारी", new: `${fullName(e)} (${e.employeeCode ?? "—"})` },
    { label: "What", labelHi: "क्या", new: label(input.kind) },
    input.kind === "SUSPENSION"
      ? { label: "Under suspension from", labelHi: "निलंबन की तिथि", new: formatDate(input.effectiveDate) }
      : { label: "Last day of service", labelHi: "सेवा का अंतिम दिन", new: formatDate(input.effectiveDate) },
    { label: "Order", labelHi: "आदेश", new: `${input.orderNumber} dated ${formatDate(input.orderDate)}` },
  ];
  if (isExit(input.kind)) rows.push({ label: "Pay", labelHi: "वेतन", new: `Stops after ${formatDate(input.effectiveDate)}; the full and final settlement follows` });
  else rows.push({ label: "Pay", labelHi: "वेतन", new: "Held in each payroll while suspended (released or settled by order)" });
  return db.$transaction(async (tx) => {
    if (await tx.separation.count({ where: { employeeId: e.id, status: "PENDING" } })) throw conflict("employees.exit.errors.waiting");
    const sep = await tx.separation.create({
      data: { boardId: actor.boardId, employeeId: e.id, kind: input.kind, effectiveDate: fromISODate(input.effectiveDate), orderNumber: input.orderNumber, orderDate: fromISODate(input.orderDate), reason: input.reason, documentId, createdById: actor.userId, createdByName: actor.name },
    });
    await submitForApproval(tx, actor, {
      kind: "separation.record",
      title: `${label(input.kind)} — ${fullName(e)} (${e.employeeCode ?? "—"})`,
      titleHi: `${label(input.kind, "hi")} — ${e.nameHi ?? fullName(e)} (${e.employeeCode ?? "—"})`,
      details: { rows, summary: input.reason, link: `/employees/exits/${sep.id}` } satisfies ApprovalDetails,
      payload: { separationId: sep.id },
      subjectEmployeeId: e.id,
      sectionId: null,
      entityType: "Separation",
      entityId: sep.id,
      note: input.reason,
    });
    await emit(tx, actor.boardId, "separation.proposed", { type: "Separation", id: sep.id }, { employeeId: e.id, kind: input.kind, effectiveDate: input.effectiveDate });
    return sep;
  });
}

/** The Admin's approval: the suspension starts, or the last day is set (and passed days move the person off the rolls). */
export async function applySeparation(tx: Tx, task: ApprovalTask, actor: Actor, separationId: string) {
  const sep = await tx.separation.findUniqueOrThrow({ where: { id: separationId }, include: { employee: true } });
  if (sep.status !== "PENDING") throw conflict("errors.alreadyDecided");
  const e = sep.employee;
  const date = toISODate(sep.effectiveDate);
  const what = label(sep.kind);
  if (sep.kind === "SUSPENSION") {
    if (e.status !== "ACTIVE") throw conflict("employees.errors.notCurrent");
    await tx.employee.update({ where: { id: e.id }, data: { status: "SUSPENDED" } });
  } else {
    if (!(CURRENT as readonly string[]).includes(e.status)) throw conflict("employees.errors.notCurrent");
    const gone = date < todayIST();
    await tx.employee.update({ where: { id: e.id }, data: { exitDate: sep.effectiveDate, exitReason: `${what} (order ${sep.orderNumber})`, ...(gone ? { status: STATUS_AFTER[sep.kind] } : {}) } });
    // A suspension still running ends with the leaving.
    await tx.separation.updateMany({ where: { employeeId: e.id, kind: "SUSPENSION", status: "APPROVED" }, data: { status: "ENDED", endDate: sep.effectiveDate, endNote: `Ended by ${what.toLowerCase()} (order ${sep.orderNumber})` } });
  }
  await tx.separation.update({ where: { id: sep.id }, data: { status: "APPROVED", approvedAt: new Date() } });
  await tx.serviceBookEntry.create({
    data: {
      employeeId: e.id,
      event: sep.kind === "SUSPENSION" ? "SUSPENSION" : "EXIT",
      eventDate: sep.effectiveDate,
      orderNumber: sep.orderNumber,
      orderDate: sep.orderDate,
      details: sep.kind === "SUSPENSION" ? `Placed under suspension from ${formatDate(date)}. ${sep.reason}` : `${what}; last day of service ${formatDate(date)}. ${sep.reason}`,
      detailsHi: sep.kind === "SUSPENSION" ? `${formatDate(date, "hi")} से निलंबित।` : `${label(sep.kind, "hi")}; सेवा का अंतिम दिन ${formatDate(date, "hi")}।`,
      data: { separationId: sep.id, kind: sep.kind },
      documentId: sep.documentId,
      status: "APPROVED",
      createdById: task.makerId,
      approvedById: actor.userId,
    },
  });
  await audit(tx, actor, { action: "APPROVE", entityType: "Separation", entityId: sep.id, summary: `${what} of ${fullName(e)} approved — ${sep.kind === "SUSPENSION" ? `suspended from ${formatDate(date)}` : `last day ${formatDate(date)}`}`, newValue: { taskId: task.id, kind: sep.kind, date }, sensitive: true });
  await emit(tx, sep.boardId, sep.kind === "SUSPENSION" ? "employee.suspended" : "employee.leaving", { type: "Employee", id: e.id }, { separationId: sep.id, kind: sep.kind, date });
}

export async function onSeparationRejected(tx: Tx, separationId: string) {
  await tx.separation.updateMany({ where: { id: separationId, status: "PENDING" }, data: { status: "REJECTED" } });
}

const exitsAppliedOn = new Map<string, ISODate>();

/** Once a day: people whose last day has passed leave the rolls (status Resigned / Terminated / Transferred). */
export async function applyExits(boardId: string, today: ISODate = todayIST()) {
  if (exitsAppliedOn.get(boardId) === today) return 0;
  exitsAppliedOn.set(boardId, today);
  const due = await db.separation.findMany({
    where: { boardId, status: "APPROVED", kind: { not: "SUSPENSION" }, effectiveDate: { lt: fromISODate(today) }, employee: { status: { in: [...CURRENT] } } },
    include: { employee: true },
  });
  for (const sep of due) {
    await db.$transaction(async (tx) => {
      const moved = await tx.employee.updateMany({ where: { id: sep.employeeId, status: { in: [...CURRENT] } }, data: { status: STATUS_AFTER[sep.kind] } });
      if (!moved.count) return;
      await tx.separation.updateMany({ where: { employeeId: sep.employeeId, kind: "SUSPENSION", status: "APPROVED" }, data: { status: "ENDED", endDate: sep.effectiveDate, endNote: `Ended by ${label(sep.kind).toLowerCase()}` } });
      await audit(tx, { boardId, name: "System (leaving service)" }, { action: "UPDATE", entityType: "Employee", entityId: sep.employeeId, summary: `${fullName(sep.employee)} left the rolls after the last day ${formatDate(toISODate(sep.effectiveDate))} (${label(sep.kind).toLowerCase()})`, category: "SYSTEM" });
      await emit(tx, boardId, "employee.left", { type: "Employee", id: sep.employeeId }, { separationId: sep.id, kind: sep.kind });
    });
  }
  return due.length;
}

/** For tests: forget that today's exits were applied. */
export function resetExitCheck() {
  exitsAppliedOn.clear();
}

/** HR asks to reinstate a suspended employee (order in hand); a Checker and an Admin decide. */
export async function proposeReinstatement(actor: Actor, separationId: string, raw: unknown) {
  if (!canRecordSeparation(actor)) throw forbidden();
  const input = reinstateSchema.parse(raw);
  const sep = await db.separation.findFirst({ where: { id: separationId, boardId: actor.boardId }, include: { employee: true } });
  if (!sep) throw notFound();
  if (sep.employeeId === actor.employeeId) throw forbidden("errors.ownPay");
  if (sep.kind !== "SUSPENSION" || sep.status !== "APPROVED" || sep.employee.status !== "SUSPENDED") throw conflict("employees.exit.errors.notSuspended");
  const today = todayIST();
  if (input.reinstatedOn <= toISODate(sep.effectiveDate)) fail("reinstatedOn", "employees.exit.errors.reinstateBefore");
  if (input.reinstatedOn > today) fail("reinstatedOn", "employees.exit.errors.reinstateFuture");
  if (input.orderDate > today) fail("orderDate", "employees.exit.errors.orderFuture");
  const e = sep.employee;
  return db.$transaction(async (tx) => {
    if (await tx.approvalTask.count({ where: { boardId: actor.boardId, entityType: "Separation", entityId: sep.id, status: "PENDING" } })) throw conflict("employees.exit.errors.waiting");
    return submitForApproval(tx, actor, {
      kind: "separation.reinstate",
      title: `Reinstatement — ${fullName(e)} (${e.employeeCode ?? "—"})`,
      titleHi: `बहाली — ${e.nameHi ?? fullName(e)} (${e.employeeCode ?? "—"})`,
      details: {
        rows: [
          { label: "Employee", labelHi: "कर्मचारी", new: `${fullName(e)} (${e.employeeCode ?? "—"})` },
          { label: "Under suspension", labelHi: "निलंबन", old: `From ${formatDate(toISODate(sep.effectiveDate))}`, new: `Until ${formatDate(addDays(input.reinstatedOn, -1))}` },
          { label: "Back on duty from", labelHi: "ड्यूटी पर वापसी", new: formatDate(input.reinstatedOn) },
          { label: "Order", labelHi: "आदेश", new: `${input.orderNumber} dated ${formatDate(input.orderDate)}` },
        ],
        summary: input.note,
        link: `/employees/exits/${sep.id}`,
      } satisfies ApprovalDetails,
      payload: { separationId: sep.id, ...input },
      subjectEmployeeId: e.id,
      entityType: "Separation",
      entityId: sep.id,
      note: input.note,
    });
  });
}

export async function applyReinstatement(tx: Tx, task: ApprovalTask, actor: Actor, payload: { separationId: string } & z.infer<typeof reinstateSchema>) {
  const sep = await tx.separation.findUniqueOrThrow({ where: { id: payload.separationId }, include: { employee: true } });
  if (sep.status !== "APPROVED" || sep.employee.status !== "SUSPENDED") throw conflict("employees.exit.errors.notSuspended");
  const lastSuspended = addDays(payload.reinstatedOn, -1);
  await tx.employee.update({ where: { id: sep.employeeId }, data: { status: "ACTIVE" } });
  await tx.separation.update({ where: { id: sep.id }, data: { status: "ENDED", endDate: fromISODate(lastSuspended), endNote: `Reinstated from ${formatDate(payload.reinstatedOn)} (order ${payload.orderNumber}). ${payload.note}` } });
  await tx.serviceBookEntry.create({
    data: {
      employeeId: sep.employeeId,
      event: "REINSTATEMENT",
      eventDate: fromISODate(payload.reinstatedOn),
      orderNumber: payload.orderNumber,
      orderDate: fromISODate(payload.orderDate),
      details: `Reinstated from ${formatDate(payload.reinstatedOn)}; under suspension ${formatDate(toISODate(sep.effectiveDate))} to ${formatDate(lastSuspended)}. ${payload.note}`,
      detailsHi: `${formatDate(payload.reinstatedOn, "hi")} से बहाल; निलंबन ${formatDate(toISODate(sep.effectiveDate), "hi")} से ${formatDate(lastSuspended, "hi")} तक।`,
      data: { separationId: sep.id },
      status: "APPROVED",
      createdById: task.makerId,
      approvedById: actor.userId,
    },
  });
  await audit(tx, actor, { action: "APPROVE", entityType: "Separation", entityId: sep.id, summary: `${fullName(sep.employee)} reinstated from ${formatDate(payload.reinstatedOn)}`, newValue: { taskId: task.id }, sensitive: true });
  await emit(tx, sep.boardId, "employee.reinstated", { type: "Employee", id: sep.employeeId }, { separationId: sep.id, reinstatedOn: payload.reinstatedOn });
}

// ─── Reading ──────────────────────────────────────────────────────────────────

const empSelect = { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, status: true, type: true, sectionId: true, exitDate: true } as const;

function view(s: { id: string; kind: string; status: string; effectiveDate: Date; orderNumber: string; orderDate: Date; reason: string; endDate: Date | null; endNote: string | null; settlementStatus: string; settlementRunId: string | null; documentId: string | null; createdByName: string; createdAt: Date; approvedAt: Date | null }) {
  return {
    id: s.id,
    kind: s.kind as SeparationKind,
    status: s.status,
    effectiveDate: toISODate(s.effectiveDate),
    orderNumber: s.orderNumber,
    orderDate: toISODate(s.orderDate),
    reason: s.reason,
    endDate: s.endDate ? toISODate(s.endDate) : null,
    endNote: s.endNote,
    settlementStatus: s.settlementStatus,
    settlementRunId: s.settlementRunId,
    documentId: s.documentId,
    createdByName: s.createdByName,
    createdAt: s.createdAt.toISOString(),
    approvedAt: s.approvedAt ? s.approvedAt.toISOString() : null,
  };
}

/** S-list: suspensions and people leaving — "open" ones need someone's action (approval, reinstatement, settlement). */
export async function listSeparations(actor: Actor, opts: { show?: string; kind?: string } = {}) {
  if (!canSeeSeparations(actor)) throw forbidden();
  void applyExits(actor.boardId).catch((err) => console.error("[employees] exits failed", err));
  const open = opts.show !== "all";
  const rows = await db.separation.findMany({
    where: {
      boardId: actor.boardId,
      ...(opts.kind && (SEPARATION_KINDS as readonly string[]).includes(opts.kind) ? { kind: opts.kind as SeparationKind } : {}),
      ...(open ? { OR: [{ status: "PENDING" }, { status: "APPROVED", kind: "SUSPENSION" }, { status: "APPROVED", kind: { not: "SUSPENSION" }, settlementStatus: { not: "SETTLED" } }] } : {}),
    },
    include: { employee: { select: empSelect } },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
  });
  return rows.map((s) => ({ ...view(s), employee: { id: s.employee.id, code: s.employee.employeeCode ?? "", name: fullName(s.employee), nameHi: s.employee.nameHi, status: s.employee.status } }));
}

export async function getSeparation(actor: Actor, id: string) {
  if (!canSeeSeparations(actor)) throw forbidden();
  const s = await db.separation.findFirst({ where: { id, boardId: actor.boardId }, include: { employee: { include: { post: true, section: true } } } });
  if (!s || !canViewEmployee(actor, s.employee)) throw notFound();
  const [tasks, doc] = await Promise.all([
    db.approvalTask.findMany({ where: { boardId: actor.boardId, entityType: "Separation", entityId: s.id, status: "PENDING" }, select: { id: true, kind: true, title: true, titleHi: true, makerId: true, makerName: true, requiredPermission: true, createdAt: true } }),
    s.documentId ? db.employeeDocument.findUnique({ where: { id: s.documentId }, select: { id: true, fileName: true } }) : null,
  ]);
  const e = s.employee;
  const own = e.id === actor.employeeId;
  return {
    ...view(s),
    employee: { id: e.id, code: e.employeeCode ?? "", name: fullName(e), nameHi: e.nameHi, status: e.status, type: e.type, post: e.post.name, postHi: e.post.nameHi, section: e.section.name, sectionHi: e.section.nameHi, doj: toISODate(e.dateOfJoining) },
    document: doc,
    tasks: tasks.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
    canReinstate: !own && canRecordSeparation(actor) && s.kind === "SUSPENSION" && s.status === "APPROVED" && e.status === "SUSPENDED" && tasks.length === 0,
  };
}

/** The separation shown on the profile: one waiting, a suspension running, or the leaving with its settlement. */
export async function currentSeparation(actor: Actor, employeeId: string) {
  if (!canSeeSeparations(actor)) return null;
  const s = await db.separation.findFirst({
    where: { boardId: actor.boardId, employeeId, OR: [{ status: "PENDING" }, { status: "APPROVED" }] },
    orderBy: [{ createdAt: "desc" }],
  });
  return s ? view(s) : null;
}

export type SeparationView = ReturnType<typeof view>;
