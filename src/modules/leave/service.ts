import "server-only";
import type { Employee, Prisma } from "@/generated/prisma/client";
import { pendingFor, submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import { canAll, scopeFor } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db, type DbLike, type Tx } from "@/lib/db";
import { addDays, formatDate, fromISODate, monthOf, shiftMonth, todayIST, toISODate, type ISODate } from "@/lib/dates";
import { AppError, badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { emit } from "@/lib/outbox";
import { loadFile, mimeOf, saveFile, sniff } from "@/lib/storage";
import { attendanceRules, gazettedHolidays, sectionOfficers } from "@/modules/attendance/service";
import { weeklyOffFor } from "@/modules/attendance/rules";
import { fullName } from "@/modules/employees/present";
import { balancesFor, ensureCredits, ledgerBalances, leaveRules, pendingDebits, usedInService, type LeaveTypeRow } from "./balance";
import { countLeaveDays, deciderFor, hasBalance, isEligible, leaveDates } from "./rules";
import { applySchema, cancelSchema, enterSchema, leaveRuleSchema } from "./schema";

const MAX_ATTACHMENT = 5 * 1024 * 1024;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

type Emp = Pick<Employee, "id" | "boardId" | "employeeCode" | "firstName" | "middleName" | "lastName" | "nameHi" | "gender" | "type" | "status" | "sectionId" | "dateOfJoining" | "exitDate">;

const empSelect = { id: true, boardId: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, gender: true, type: true, status: true, sectionId: true, dateOfJoining: true, exitDate: true } as const;

// ─── Access ───────────────────────────────────────────────────────────────────

/** Whose leave the actor may see: the whole Board, their section (reporting officer), or only their own. */
export function canSeeLeaveOf(actor: Actor, e: Pick<Employee, "id" | "sectionId">) {
  const scope = scopeFor(actor, "leave", "view");
  if (scope === "all") return true;
  if (actor.employeeId === e.id) return true;
  return scope === "section" && !!actor.sectionId && actor.sectionId === e.sectionId;
}

export const canEnterLeave = (actor: Actor) => canAll(actor, "leave", "create");

// ─── Working out an application ───────────────────────────────────────────────

interface Input {
  leaveCode: string;
  fromDate: ISODate;
  toDate: ISODate;
  halfDay: boolean;
}

export interface Prepared {
  type: LeaveTypeRow;
  days: number;
  debitCode: string;
  debitDays: number;
  dates: ISODate[];
  /** Balance before and after, for leave that keeps one. */
  balance: number | null;
  after: number | null;
}

function fail(field: string, key: string, vars?: Record<string, string | number>): never {
  throw new AppError(400, "invalid", key as never, vars, { [field]: key });
}

/**
 * Checks an application against the leave rules (LV-01, LV-03) and works out the days. Used for the live preview,
 * on submit and again when it is approved.
 */
export async function prepareLeave(
  e: Emp,
  input: Input,
  opts: { selfService: boolean; exceptId?: string; tx?: DbLike },
): Promise<Prepared> {
  const tx = opts.tx ?? db;
  const today = todayIST();
  const types = await leaveRules(e.boardId, tx);
  const type = types.find((t) => t.code === input.leaveCode && t.isActive);
  if (!type || !isEligible(type, e)) fail("leaveCode", "leave.errors.notEligible");
  if (input.toDate < input.fromDate) fail("toDate", "leave.errors.toBeforeFrom");
  if (input.halfDay && (!type.halfDayAllowed || input.fromDate !== input.toDate)) fail("halfDay", "leave.errors.halfDayNotAllowed");
  if (input.fromDate < toISODate(e.dateOfJoining)) fail("fromDate", "leave.errors.beforeJoining");
  if (e.exitDate && input.toDate > toISODate(e.exitDate)) fail("toDate", "leave.errors.afterExit");
  if (opts.selfService && input.fromDate < `${shiftMonth(monthOf(today), -1)}-01`) fail("fromDate", "leave.errors.tooOld");
  if (input.toDate > addDays(today, 365)) fail("toDate", "leave.errors.tooFar");

  const section = await tx.section.findUniqueOrThrow({ where: { id: e.sectionId } });
  const rules = await attendanceRules(e.boardId, tx);
  const holidays = new Set((await gazettedHolidays(e.boardId, input.fromDate, input.toDate, tx)).keys());
  const weeklyOff = weeklyOffFor(section.weeklyOff, rules.weeklyOff);
  if (type.restrictedOnly) {
    if (input.fromDate !== input.toDate) fail("toDate", "leave.errors.oneDayOnly");
    const rh = await tx.holiday.findFirst({ where: { boardId: e.boardId, date: fromISODate(input.fromDate), kind: "RESTRICTED" } });
    if (!rh) fail("fromDate", "leave.errors.notRestrictedHoliday");
  }
  const days = type.restrictedOnly ? 1 : countLeaveDays({ from: input.fromDate, to: input.toDate, halfDay: input.halfDay, countsOffDays: type.countsOffDays, holidays, weeklyOff });
  if (days <= 0) fail("toDate", "leave.errors.noDays");
  const dates = type.restrictedOnly ? [input.fromDate] : leaveDates({ from: input.fromDate, to: input.toDate, countsOffDays: type.countsOffDays, holidays, weeklyOff });

  // Limits and balances.
  if (type.creditMode === "SPELL" && days > type.creditDays) fail("toDate", "leave.errors.overSpell", { max: type.creditDays });
  if (type.creditMode === "SERVICE") {
    const left = type.creditDays - (await usedInService(e.id, type.code, tx, opts.exceptId));
    if (days > left) fail("toDate", "leave.errors.overService", { left: fmt(left) });
  }
  const debitCode = type.debitFrom ?? type.code;
  const debitDays = days * type.debitFactor;
  let balance: number | null = null;
  let after: number | null = null;
  const source = types.find((t) => t.code === debitCode);
  if (source && hasBalance(source)) {
    balance = (await ledgerBalances(e.id, tx)).get(debitCode) ?? 0;
    const waiting = (await pendingDebits(e.id, tx, opts.exceptId)).get(debitCode) ?? 0;
    if (debitDays > balance - waiting) fail("toDate", "leave.errors.short", { code: debitCode, available: fmt(balance - waiting), needed: fmt(debitDays) });
    // What can still be asked for, before and after this application (other waiting applications already counted).
    balance -= waiting;
    after = balance - debitDays;
  }

  // No overlap with other leave, and nothing inside a locked month.
  const overlap = await tx.leaveApplication.findFirst({
    where: { employeeId: e.id, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: fromISODate(input.toDate) }, toDate: { gte: fromISODate(input.fromDate) }, ...(opts.exceptId ? { id: { not: opts.exceptId } } : {}) },
  });
  if (overlap) fail("fromDate", "leave.errors.overlap", { from: formatDate(toISODate(overlap.fromDate)), to: formatDate(toISODate(overlap.toDate)) });
  const months = [...new Set(dates.map(monthOf))];
  const lock = await tx.attendanceLock.findFirst({ where: { boardId: e.boardId, sectionId: e.sectionId, month: { in: months }, unlockedAt: null } });
  if (lock) fail("fromDate", "leave.errors.locked", { month: lock.month });

  return { type, days, debitCode, debitDays, dates, balance, after };
}

async function ownEmployee(actor: Actor) {
  if (!actor.employeeId || !scopeFor(actor, "leave", "create")) throw forbidden();
  const e = await db.employee.findUnique({ where: { id: actor.employeeId }, select: empSelect });
  if (!e || e.status !== "ACTIVE") throw forbidden();
  return e;
}

/** Live preview while typing: days, balance after, and who will decide (LV-03 "live balance"). */
export async function previewLeave(actor: Actor, raw: unknown) {
  const body = raw as { employeeId?: string };
  const onBehalf = !!body?.employeeId && canEnterLeave(actor);
  const input = applySchema.partial({ reason: true }).parse(raw);
  const e = onBehalf ? await db.employee.findFirst({ where: { id: body.employeeId, boardId: actor.boardId }, select: empSelect }) : await ownEmployee(actor);
  if (!e) throw notFound();
  const p = await prepareLeave(e, input, { selfService: !onBehalf });
  const officers = (await sectionOfficers(actor.boardId, e.sectionId)).filter((o) => o.employeeId !== e.id);
  return {
    days: p.days,
    debitCode: p.debitCode,
    debitDays: p.debitDays,
    balance: p.balance,
    after: p.after,
    decider: deciderFor(p.type, p.days, officers.length > 0),
  };
}

function detailsFor(e: Emp, p: Prepared, input: Input & { reason: string; contact?: string; sanctionRef?: string }, id: string): ApprovalDetails {
  const dates = input.fromDate === input.toDate ? formatDate(input.fromDate) : `${formatDate(input.fromDate)} – ${formatDate(input.toDate)}`;
  return {
    rows: [
      { label: "Leave", labelHi: "अवकाश", new: `${p.type.name} (${p.type.code})` },
      { label: "Dates", labelHi: "तारीखें", new: `${dates}${input.halfDay ? " (half day)" : ""}` },
      { label: "Days", labelHi: "दिन", new: fmt(p.days) + (p.debitCode !== p.type.code ? ` (${fmt(p.debitDays)} days of ${p.debitCode})` : "") },
      ...(p.balance !== null ? [{ label: `${p.debitCode} balance`, labelHi: `${p.debitCode} शेष`, old: fmt(p.balance), new: fmt(p.after!) }] : []),
      { label: "Reason", labelHi: "कारण", new: input.reason },
      ...(input.contact ? [{ label: "Contact during leave", labelHi: "अवकाश में संपर्क", new: input.contact }] : []),
      ...(input.sanctionRef ? [{ label: "Sanction order", labelHi: "स्वीकृति आदेश", new: input.sanctionRef }] : []),
    ],
    link: `/leave/applications/${id}`,
    summary: `${fullName(e)} (${e.employeeCode})`,
  };
}

/** LV-03: an employee applies; the reporting officer decides within their limit, an Admin beyond it. */
export async function applyLeave(actor: Actor, raw: unknown, file?: File | null) {
  const input = applySchema.parse(raw);
  const e = await ownEmployee(actor);
  await ensureCredits(actor.boardId);
  const p = await prepareLeave(e, input, { selfService: true });
  let attachment: { key: string; sha256: string; name: string } | null = null;
  if (file && file.size > 0) {
    if (file.size > MAX_ATTACHMENT) fail("file", "employees.errors.fileTooBig");
    const buffer = Buffer.from(await file.arrayBuffer());
    const kind = sniff(buffer);
    if (!kind || !["pdf", "png", "jpg"].includes(kind)) fail("file", "employees.errors.fileType");
    const stored = await saveFile("leave", buffer, kind);
    attachment = { key: stored.key, sha256: stored.sha256, name: file.name.slice(0, 200) };
  }
  if (p.type.needsCertificate && !attachment) fail("file", "leave.errors.certificate");

  return db.$transaction(async (tx) => {
    const application = await tx.leaveApplication.create({
      data: {
        boardId: actor.boardId,
        employeeId: e.id,
        leaveCode: p.type.code,
        fromDate: fromISODate(input.fromDate),
        toDate: fromISODate(input.toDate),
        halfDay: input.halfDay,
        days: p.days,
        debitCode: p.debitCode,
        debitDays: p.debitDays,
        reason: input.reason,
        contact: input.contact || null,
        attachmentKey: attachment?.key ?? null,
        attachmentName: attachment?.name ?? null,
        attachmentSha256: attachment?.sha256 ?? null,
        createdById: actor.userId,
      },
    });
    const officers = (await sectionOfficers(actor.boardId, e.sectionId, tx)).filter((o) => o.employeeId !== e.id);
    const decider = deciderFor(p.type, p.days, officers.length > 0);
    const name = fullName(e);
    const task = await submitForApproval(tx, actor, {
      kind: "leave.apply",
      requiredPermission: decider,
      sectionId: decider === "REPORTING_OFFICER" ? e.sectionId : null,
      title: `${p.type.code} ${fmt(p.days)} day${p.days === 1 ? "" : "s"}: ${name} · ${formatDate(input.fromDate)}`,
      titleHi: `${p.type.nameHi} ${fmt(p.days)} दिन: ${e.nameHi ?? name} · ${formatDate(input.fromDate, "hi")}`,
      details: detailsFor(e, p, input, application.id),
      payload: { applicationId: application.id },
      entityType: "LeaveApplication",
      entityId: application.id,
      subjectEmployeeId: e.id,
      note: input.reason,
    });
    await tx.leaveApplication.update({ where: { id: application.id }, data: { taskId: task.id } });
    await audit(tx, actor, { action: "CREATE", entityType: "LeaveApplication", entityId: application.id, summary: `Applied for ${p.type.code} ${fmt(p.days)} day(s) from ${formatDate(input.fromDate)}` });
    return application;
  });
}

/**
 * LV-05: HR enters leave sanctioned on paper for someone who does not use the system. It is decided like any
 * application — the section's reporting officer within their limit, an Admin beyond it (PRD §14 leave row).
 */
export async function enterLeave(actor: Actor, raw: unknown) {
  if (!canEnterLeave(actor)) throw forbidden();
  const input = enterSchema.parse(raw);
  const e = await db.employee.findFirst({ where: { id: input.employeeId, boardId: actor.boardId, employeeCode: { not: null } }, select: empSelect });
  if (!e) throw notFound();
  await ensureCredits(actor.boardId);
  const p = await prepareLeave(e, input, { selfService: false });
  return db.$transaction(async (tx) => {
    const application = await tx.leaveApplication.create({
      data: {
        boardId: actor.boardId,
        employeeId: e.id,
        leaveCode: p.type.code,
        fromDate: fromISODate(input.fromDate),
        toDate: fromISODate(input.toDate),
        halfDay: input.halfDay,
        days: p.days,
        debitCode: p.debitCode,
        debitDays: p.debitDays,
        reason: input.reason,
        contact: input.contact || null,
        onBehalf: true,
        sanctionRef: input.sanctionRef,
        createdById: actor.userId,
      },
    });
    const name = fullName(e);
    const officers = (await sectionOfficers(actor.boardId, e.sectionId, tx)).filter((o) => o.employeeId !== e.id);
    const decider = deciderFor(p.type, p.days, officers.length > 0);
    const task = await submitForApproval(tx, actor, {
      kind: "leave.entry",
      requiredPermission: decider,
      sectionId: decider === "REPORTING_OFFICER" ? e.sectionId : null,
      title: `Leave entry: ${p.type.code} ${fmt(p.days)} day(s) for ${name} · ${formatDate(input.fromDate)}`,
      titleHi: `अवकाश प्रविष्टि: ${e.nameHi ?? name} — ${p.type.nameHi} ${fmt(p.days)} दिन · ${formatDate(input.fromDate, "hi")}`,
      details: detailsFor(e, p, input, application.id),
      payload: { applicationId: application.id },
      entityType: "LeaveApplication",
      entityId: application.id,
      subjectEmployeeId: e.id,
      note: input.reason,
    });
    await tx.leaveApplication.update({ where: { id: application.id }, data: { taskId: task.id } });
    await audit(tx, actor, { action: "CREATE", entityType: "LeaveApplication", entityId: application.id, summary: `Entered ${p.type.code} ${fmt(p.days)} day(s) for ${name} (sanction ${input.sanctionRef})` });
    return application;
  });
}

/** LV-04: an approved application debits the balance and marks the days as leave. */
export async function approveLeave(tx: Tx, actor: Actor, applicationId: string) {
  const a = await tx.leaveApplication.findUniqueOrThrow({ where: { id: applicationId } });
  if (a.status !== "PENDING") throw conflict("errors.alreadyDecided");
  const e = await tx.employee.findUniqueOrThrow({ where: { id: a.employeeId }, select: empSelect });
  const p = await prepareLeave(e, { leaveCode: a.leaveCode, fromDate: toISODate(a.fromDate), toDate: toISODate(a.toDate), halfDay: a.halfDay }, { selfService: false, exceptId: a.id, tx });
  await tx.leaveLedger.create({
    data: {
      boardId: a.boardId,
      employeeId: a.employeeId,
      leaveCode: p.debitCode,
      date: a.fromDate,
      kind: "DEBIT",
      days: -p.debitDays,
      applicationId: a.id,
      note: `${p.type.code} ${formatDate(toISODate(a.fromDate))}${a.fromDate.getTime() !== a.toDate.getTime() ? ` – ${formatDate(toISODate(a.toDate))}` : ""}${a.halfDay ? " (half day)" : ""}`,
      createdById: actor.userId,
    },
  });
  for (const d of p.dates) {
    const date = fromISODate(d);
    await tx.attendanceDay.upsert({
      where: { employeeId_date: { employeeId: a.employeeId, date } },
      create: { boardId: a.boardId, employeeId: a.employeeId, date, status: "LEAVE", leaveCode: a.leaveCode, half: a.halfDay, source: "LEAVE", applicationId: a.id, updatedById: actor.userId },
      update: { status: "LEAVE", leaveCode: a.leaveCode, half: a.halfDay, source: "LEAVE", applicationId: a.id, checked: true, updatedById: actor.userId },
    });
  }
  await tx.leaveApplication.update({ where: { id: a.id }, data: { status: "APPROVED", decidedAt: new Date(), days: p.days, debitDays: p.debitDays } });
  await emit(tx, a.boardId, "leave.approved", { type: "LeaveApplication", id: a.id }, { employeeId: a.employeeId, leaveCode: a.leaveCode, from: toISODate(a.fromDate), to: toISODate(a.toDate), days: p.days, pay: p.type.pay });
}

export async function closeLeave(tx: Tx, applicationId: string, status: "REJECTED" | "RETURNED" | "CANCELLED") {
  await tx.leaveApplication.update({ where: { id: applicationId }, data: { status, decidedAt: new Date() } });
}

/**
 * LV-03 cancel: the employee cancels approved leave that has not started; HR can cancel any approved leave in
 * a month that is not locked. The balance and the days go back.
 */
export async function cancelLeave(actor: Actor, applicationId: string, raw: unknown) {
  const { note } = cancelSchema.parse(raw);
  const a = await db.leaveApplication.findFirst({ where: { id: applicationId, boardId: actor.boardId } });
  if (!a) throw notFound();
  const own = actor.employeeId === a.employeeId;
  const hr = canEnterLeave(actor);
  if (!own && !hr) throw forbidden();
  if (a.status !== "APPROVED") throw badRequest("leave.errors.notApproved");
  if (!hr && toISODate(a.fromDate) <= todayIST()) throw badRequest("leave.errors.alreadyStarted");
  const e = await db.employee.findUniqueOrThrow({ where: { id: a.employeeId }, select: empSelect });
  return db.$transaction(async (tx) => {
    const days = await tx.attendanceDay.findMany({ where: { applicationId: a.id }, select: { date: true } });
    const months = [...new Set(days.map((d) => monthOf(toISODate(d.date))))];
    const lock = months.length ? await tx.attendanceLock.findFirst({ where: { boardId: a.boardId, sectionId: e.sectionId, month: { in: months }, unlockedAt: null } }) : null;
    if (lock) throw conflict("leave.errors.locked", { month: lock.month });
    await tx.leaveLedger.create({
      data: { boardId: a.boardId, employeeId: a.employeeId, leaveCode: a.debitCode, date: fromISODate(todayIST()), kind: "REVERSAL", days: Number(a.debitDays), applicationId: a.id, note: `Cancelled: ${note}`, createdById: actor.userId },
    });
    await tx.attendanceDay.deleteMany({ where: { applicationId: a.id, source: "LEAVE" } });
    const updated = await tx.leaveApplication.update({ where: { id: a.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelNote: note } });
    await audit(tx, actor, { action: "CANCEL", entityType: "LeaveApplication", entityId: a.id, summary: `Cancelled ${a.leaveCode} of ${fullName(e)} from ${formatDate(toISODate(a.fromDate))}: ${note}` });
    await emit(tx, a.boardId, "leave.cancelled", { type: "LeaveApplication", id: a.id }, { employeeId: a.employeeId, leaveCode: a.leaveCode });
    return updated;
  });
}

// ─── Reading ──────────────────────────────────────────────────────────────────

/** S-31 for the employee: balances, applications and the restricted holidays still to come. */
export async function myLeave(actor: Actor) {
  if (!actor.employeeId) throw forbidden();
  await ensureCredits(actor.boardId);
  const e = await db.employee.findUniqueOrThrow({ where: { id: actor.employeeId }, select: empSelect });
  const today = todayIST();
  const [balances, applications, rh] = await Promise.all([
    balancesFor(e, actor.boardId),
    db.leaveApplication.findMany({ where: { employeeId: e.id }, orderBy: { fromDate: "desc" }, take: 50 }),
    db.holiday.findMany({ where: { boardId: actor.boardId, kind: "RESTRICTED", date: { gte: fromISODate(today), lte: fromISODate(addDays(today, 365)) } }, orderBy: { date: "asc" } }),
  ]);
  return { employee: e, balances, applications, restrictedHolidays: rh.map((h) => ({ date: toISODate(h.date), name: h.name, nameHi: h.nameHi })), today };
}

export async function getApplication(actor: Actor, id: string) {
  const a = await db.leaveApplication.findFirst({ where: { id, boardId: actor.boardId } });
  if (!a) throw notFound();
  const e = await db.employee.findUniqueOrThrow({ where: { id: a.employeeId }, select: { ...empSelect, post: { select: { name: true, nameHi: true } }, section: { select: { name: true, nameHi: true } } } });
  const task = a.taskId ? await db.approvalTask.findUnique({ where: { id: a.taskId } }) : null;
  const decider = task?.requiredPermission;
  if (!canSeeLeaveOf(actor, e) && !(decider && actor.permissions.includes(decider))) throw forbidden();
  const type = (await leaveRules(actor.boardId)).find((t) => t.code === a.leaveCode);
  const balances = await balancesFor(e, actor.boardId);
  return { application: a, employee: e, type, task, balances };
}

export async function readAttachment(actor: Actor, id: string) {
  const { application: a, employee } = await getApplication(actor, id);
  if (!a.attachmentKey) throw notFound();
  const buffer = await loadFile(a.attachmentKey);
  const kind = sniff(buffer) ?? "pdf";
  await audit(db, actor, { action: "DOWNLOAD", entityType: "LeaveApplication", entityId: a.id, summary: `Opened the certificate of ${fullName(employee)}'s ${a.leaveCode}` });
  return { buffer, name: a.attachmentName ?? `certificate.${kind}`, mimeType: mimeOf(kind) };
}

/** HR list (and Checker / Payroll / Admin view): applications by status. */
export async function listApplications(actor: Actor, opts: { status?: "PENDING" | "APPROVED" | "ALL"; take?: number } = {}) {
  const scope = scopeFor(actor, "leave", "view");
  if (scope !== "all") throw forbidden();
  const where: Prisma.LeaveApplicationWhereInput = { boardId: actor.boardId, ...(opts.status && opts.status !== "ALL" ? { status: opts.status } : {}) };
  const rows = await db.leaveApplication.findMany({ where, orderBy: [{ status: "asc" }, { fromDate: "desc" }], take: opts.take ?? 100 });
  const people = await db.employee.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { ...empSelect, section: { select: { name: true, nameHi: true } } } });
  const byId = new Map(people.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, employee: byId.get(r.employeeId)! }));
}

/** Reporting officer: who in the section is on leave or has asked for it in a month. */
export async function teamLeave(actor: Actor, month: string) {
  if (scopeFor(actor, "leave", "approve") !== "section" || !actor.sectionId) throw forbidden();
  await ensureCredits(actor.boardId);
  const staff = await db.employee.findMany({ where: { boardId: actor.boardId, sectionId: actor.sectionId, employeeCode: { not: null }, status: { in: ["ACTIVE", "SUSPENDED"] } }, select: empSelect, orderBy: { employeeCode: "asc" } });
  const from = fromISODate(`${month}-01`);
  const to = fromISODate(toISODate(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))));
  const applications = await db.leaveApplication.findMany({ where: { employeeId: { in: staff.map((s) => s.id) }, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: to }, toDate: { gte: from } }, orderBy: { fromDate: "asc" } });
  const balances = await Promise.all(staff.map(async (s) => ({ employee: s, balances: await balancesFor(s, actor.boardId) })));
  return { staff, applications, balances };
}

export interface LedgerLine {
  date: string;
  code: string;
  kind: string;
  days: number;
  balance: number;
  note: string | null;
}

/** LV-07: the leave account — credits, debits and running balance per leave. */
export async function employeeLeave(actor: Actor, employeeId: string) {
  const e = await db.employee.findFirst({ where: { id: employeeId, boardId: actor.boardId }, select: { ...empSelect, post: { select: { name: true, nameHi: true } }, section: { select: { name: true, nameHi: true } } } });
  if (!e) throw notFound();
  if (!canSeeLeaveOf(actor, e)) throw forbidden();
  await ensureCredits(actor.boardId);
  const [entries, balances, applications, types] = await Promise.all([
    db.leaveLedger.findMany({ where: { employeeId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
    balancesFor(e, actor.boardId),
    db.leaveApplication.findMany({ where: { employeeId }, orderBy: { fromDate: "desc" }, take: 100 }),
    leaveRules(actor.boardId),
  ]);
  const running = new Map<string, number>();
  const lines: LedgerLine[] = entries.map((x) => {
    const days = Number(x.days);
    const balance = (running.get(x.leaveCode) ?? 0) + days;
    running.set(x.leaveCode, balance);
    return { date: toISODate(x.date), code: x.leaveCode, kind: x.kind, days, balance, note: x.note };
  });
  return { employee: e, lines, balances, applications, types };
}

// ─── Rules table (LV-01) ───────────────────────────────────────────────────────

const RULE_FIELDS = ["name", "nameHi", "pay", "creditMode", "creditDays", "cap", "lapsesAtYearEnd", "countsOffDays", "halfDayAllowed", "needsCertificate", "officerLimitDays", "isActive"] as const;

/** HR proposes a change to (or a new row in) the leave rules table; an Admin approves it. */
export async function proposeLeaveRule(actor: Actor, raw: unknown) {
  if (!canAll(actor, "rates_rules", "create")) throw forbidden();
  const input = leaveRuleSchema.parse(raw);
  const current = (await leaveRules(actor.boardId)).find((t) => t.code === input.code) ?? null;
  const rows: NonNullable<ApprovalDetails["rows"]> = [];
  for (const f of RULE_FIELDS) {
    const before = current ? current[f] : null;
    const after = input[f];
    if (JSON.stringify(before) !== JSON.stringify(after)) rows.push({ label: f, old: before === null || before === undefined ? null : String(before), new: after === null ? "—" : String(after) });
  }
  if (!rows.length) throw badRequest("leave.errors.noChange");
  return db.$transaction(async (tx) => {
    if ((await pendingFor(actor.boardId, "LeaveType", input.code, ["leave.rule"], tx)).length) throw conflict("leave.errors.rulePending");
    const task = await submitForApproval(tx, actor, {
      kind: "leave.rule",
      title: `${current ? "Leave rule change" : "New leave type"}: ${input.code} (${input.name})`,
      titleHi: `${current ? "अवकाश नियम में बदलाव" : "नया अवकाश प्रकार"}: ${input.code} (${input.nameHi})`,
      details: { rows, link: "/leave/manage?tab=rules", summary: current ? `Version ${current.version} → ${current.version + 1}` : "New row in the leave rules table" } satisfies ApprovalDetails,
      payload: { ...input, isNew: !current },
      entityType: "LeaveType",
      entityId: input.code,
      note: input.note,
    });
    await audit(tx, actor, { action: "SUBMIT", entityType: "LeaveType", entityId: input.code, summary: `Proposed a change to leave rule ${input.code}`, newValue: input });
    return task;
  });
}

export async function applyLeaveRule(tx: Tx, boardId: string, payload: ReturnType<typeof leaveRuleSchema.parse> & { isNew: boolean }) {
  const data = {
    name: payload.name,
    nameHi: payload.nameHi,
    pay: payload.pay,
    creditMode: payload.creditMode,
    creditDays: payload.creditDays,
    cap: payload.cap,
    lapsesAtYearEnd: payload.lapsesAtYearEnd,
    countsOffDays: payload.countsOffDays,
    halfDayAllowed: payload.halfDayAllowed,
    needsCertificate: payload.needsCertificate,
    officerLimitDays: payload.officerLimitDays,
    isActive: payload.isActive,
  };
  const existing = await tx.leaveType.findUnique({ where: { boardId_code: { boardId, code: payload.code } } });
  if (existing) await tx.leaveType.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
  else {
    const last = await tx.leaveType.aggregate({ where: { boardId }, _max: { sortOrder: true } });
    await tx.leaveType.create({ data: { ...data, boardId, code: payload.code, employeeTypes: ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION", "REEMPLOYED"], sortOrder: (last._max.sortOrder ?? 0) + 1 } });
  }
  await emit(tx, boardId, "leave.rule_changed", { type: "LeaveType", id: payload.code }, data);
}

/** LV-06: opening balances, as on the cut-over date (EL, HPL, CL as balances; CCL as days already used). */
export async function applyOpening(tx: Tx, boardId: string, payload: { asOn: ISODate; rows: { employeeId: string; leaveCode: string; days: number }[] }, makerId: string) {
  const types = new Map((await leaveRules(boardId, tx)).map((t) => [t.code, t]));
  for (const r of payload.rows) {
    const t = types.get(r.leaveCode);
    if (!t) continue;
    await tx.leaveLedger.deleteMany({ where: { employeeId: r.employeeId, leaveCode: r.leaveCode, kind: "OPENING" } });
    await tx.leaveLedger.create({
      data: {
        boardId,
        employeeId: r.employeeId,
        leaveCode: r.leaveCode,
        date: fromISODate(payload.asOn),
        kind: "OPENING",
        days: r.days,
        period: "opening",
        note: t.creditMode === "SERVICE" ? `Days used before ${formatDate(payload.asOn)}` : `Opening balance as on ${formatDate(payload.asOn)}`,
        createdById: makerId,
      },
    });
  }
  await emit(tx, boardId, "leave.opening_loaded", { type: "LeaveLedger", id: payload.asOn }, { rows: payload.rows.length });
}

/** HR balances list: CL, EL and HPL for each person (search by name or Employee ID). */
export async function balancesOverview(actor: Actor, q?: string) {
  if (scopeFor(actor, "leave", "view") !== "all") throw forbidden();
  await ensureCredits(actor.boardId);
  const term = q?.trim();
  const staff = await db.employee.findMany({
    where: {
      boardId: actor.boardId,
      employeeCode: { not: null },
      status: { in: ["ACTIVE", "SUSPENDED"] },
      ...(term
        ? { OR: [{ employeeCode: { contains: term, mode: "insensitive" } }, { firstName: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } }, { nameHi: { contains: term } }] }
        : {}),
    },
    select: { ...empSelect, section: { select: { name: true, nameHi: true } } },
    orderBy: { employeeCode: "asc" },
    take: 60,
  });
  const ids = staff.map((s) => s.id);
  const [sums, pending] = await Promise.all([
    db.leaveLedger.groupBy({ by: ["employeeId", "leaveCode"], where: { employeeId: { in: ids } }, _sum: { days: true } }),
    db.leaveApplication.groupBy({ by: ["employeeId"], where: { employeeId: { in: ids }, status: "PENDING" }, _count: true }),
  ]);
  const bal = new Map(sums.map((s) => [`${s.employeeId}|${s.leaveCode}`, Number(s._sum.days ?? 0)]));
  const waiting = new Map(pending.map((p) => [p.employeeId, p._count]));
  return staff.map((s) => ({ ...s, balances: { CL: bal.get(`${s.id}|CL`) ?? null, EL: bal.get(`${s.id}|EL`) ?? null, HPL: bal.get(`${s.id}|HPL`) ?? null }, waiting: waiting.get(s.id) ?? 0 }));
}
