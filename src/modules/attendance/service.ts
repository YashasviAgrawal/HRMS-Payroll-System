import "server-only";
import type { AttendanceDay, DayStatus, Employee, Prisma, Section } from "@/generated/prisma/client";
import { pendingFor, submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import { canAll, scopeFor } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db, type DbLike, type Tx } from "@/lib/db";
import {
  addDays,
  datesOfMonth,
  formatDate,
  formatMonth,
  fromISODate,
  istInstant,
  monthOf,
  shiftMonth,
  toISODate,
  todayIST,
  type ISODate,
} from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { emit } from "@/lib/outbox";
import { fullName } from "@/modules/employees/present";
import { balancesFor, leaveRules } from "@/modules/leave/balance";
import { getSetting } from "@/modules/settings/service";
import {
  EXCEPTION_STATUSES,
  calendarDay,
  monthTotals,
  resolveDay,
  statusFromPunches,
  weeklyOffFor,
  type AttendanceRules,
  type MonthTotals,
  type ResolvedDay,
} from "./rules";
import { attendanceRequestSchema, lockSchema, musterSchema, sectionRulesSchema, unlockSchema } from "./schema";

export const STATUS_EN: Record<DayStatus, string> = {
  PRESENT: "Present",
  LATE: "Late",
  HALF_DAY: "Half day",
  ABSENT: "Absent",
  MISSED_PUNCH: "Missed punch",
  ON_DUTY: "On duty",
  LEAVE: "On leave",
  HOLIDAY: "Holiday",
  WEEKLY_OFF: "Weekly off",
  DIES_NON: "Dies-non",
};

/** Staff who count for attendance: issued an Employee ID and not a draft. */
const ON_ROLLS: Prisma.EmployeeWhereInput = { employeeCode: { not: null }, status: { not: "DRAFT" } };

// ─── Access ────────────────────────────────────────────────────────────────────

/** "all" for HR, Checker, Payroll and Admin; the officer's own section; null for no access. */
export function sectionScope(actor: Actor): "all" | string | null {
  const scope = scopeFor(actor, "attendance", "view");
  if (scope === "all") return "all";
  if (scope === "section" && actor.sectionId) return actor.sectionId;
  return null;
}

export function canViewSection(actor: Actor, sectionId: string) {
  const s = sectionScope(actor);
  return s === "all" || s === sectionId;
}

/** AT-05: the reporting officer locks their own section; HR may lock any section. */
export function canLockSection(actor: Actor, sectionId: string) {
  const scope = scopeFor(actor, "attendance", "lock");
  return scope === "all" || (scope === "section" && actor.sectionId === sectionId);
}

export const canEnterMuster = (actor: Actor) => canAll(actor, "attendance", "create");

// ─── Rules and calendar ───────────────────────────────────────────────────────

export async function attendanceRules(boardId: string, tx: DbLike = db): Promise<AttendanceRules & { lockDay: number }> {
  const [a, general] = await Promise.all([getSetting(boardId, "attendance", tx), getSetting(boardId, "general", tx)]);
  return { officeStart: a.officeStart, graceMinutes: a.graceMinutes, halfDayMinutes: a.halfDayMinutes, weeklyOff: a.weeklyOff, lockDay: general.attendanceLockDay };
}

/** Gazetted holidays between two dates (restricted holidays are optional, so they do not close the office). */
export async function gazettedHolidays(boardId: string, from: ISODate, to: ISODate, tx: DbLike = db) {
  const rows = await tx.holiday.findMany({ where: { boardId, kind: "GAZETTED", date: { gte: fromISODate(from), lte: fromISODate(to) } }, orderBy: { date: "asc" } });
  return new Map(rows.map((h) => [toISODate(h.date), h]));
}

/** The month a lock is due for, and when: last month, due on the lock day of this month (D-17). */
export function lockDue(today: ISODate, lockDay: number) {
  const month = shiftMonth(monthOf(today), -1);
  const due = `${monthOf(today)}-${String(lockDay).padStart(2, "0")}`;
  return { month, due, overdue: today > due };
}

export async function lockOf(boardId: string, sectionId: string, month: string, tx: DbLike = db) {
  const lock = await tx.attendanceLock.findUnique({ where: { boardId_sectionId_month: { boardId, sectionId, month } } });
  return lock && !lock.unlockedAt ? lock : null;
}

async function assertUnlocked(tx: DbLike, boardId: string, sectionId: string, month: string) {
  if (await lockOf(boardId, sectionId, month, tx)) throw conflict("attendance.errors.locked", { month: formatMonth(month) });
}

// ─── Building a month ─────────────────────────────────────────────────────────

type Emp = Pick<Employee, "id" | "employeeCode" | "firstName" | "middleName" | "lastName" | "nameHi" | "type" | "sectionId" | "dateOfJoining" | "exitDate" | "biometricId"> & {
  post: { name: string; nameHi: string };
};

export interface RegisterDay extends ResolvedDay {
  date: ISODate;
  /** A muster entry or HR correction waiting for the Checker. */
  pending?: DayStatus | null | "CLEAR";
  holidayName?: string;
}

export interface RegisterRow {
  employee: { id: string; code: string; name: string; nameHi: string | null; post: string; postHi: string; type: Employee["type"]; biometricId: string | null };
  days: RegisterDay[];
  totals: MonthTotals;
}

const empSelect = {
  id: true,
  employeeCode: true,
  firstName: true,
  middleName: true,
  lastName: true,
  nameHi: true,
  type: true,
  sectionId: true,
  dateOfJoining: true,
  exitDate: true,
  biometricId: true,
  post: { select: { name: true, nameHi: true } },
} as const;

function monthRange(month: string) {
  const dates = datesOfMonth(month);
  return { dates, from: dates[0], to: dates[dates.length - 1] };
}

async function employeesOn(boardId: string, where: Prisma.EmployeeWhereInput, from: ISODate, to: ISODate, tx: DbLike = db): Promise<Emp[]> {
  return tx.employee.findMany({
    where: {
      boardId,
      ...ON_ROLLS,
      ...where,
      dateOfJoining: { lte: fromISODate(to) },
      OR: [{ exitDate: null }, { exitDate: { gte: fromISODate(from) } }],
    },
    select: empSelect,
    orderBy: [{ employeeCode: "asc" }],
  });
}

/** Punches grouped by employee and India date. */
async function punchesBetween(employeeIds: string[], from: ISODate, to: ISODate, tx: DbLike = db) {
  const rows = employeeIds.length
    ? await tx.attendancePunch.findMany({
        where: { employeeId: { in: employeeIds }, at: { gte: istInstant(from, "00:00"), lt: istInstant(addDays(to, 1), "00:00") } },
        select: { employeeId: true, at: true },
        orderBy: { at: "asc" },
      })
    : [];
  const map = new Map<string, Date[]>();
  for (const p of rows) {
    const key = `${p.employeeId}|${todayIST(p.at)}`;
    const list = map.get(key) ?? [];
    list.push(p.at);
    map.set(key, list);
  }
  return map;
}

async function savedBetween(employeeIds: string[], from: ISODate, to: ISODate, tx: DbLike = db) {
  const rows = employeeIds.length ? await tx.attendanceDay.findMany({ where: { employeeId: { in: employeeIds }, date: { gte: fromISODate(from), lte: fromISODate(to) } } }) : [];
  return new Map(rows.map((d) => [`${d.employeeId}|${toISODate(d.date)}`, d]));
}

interface BuildInput {
  boardId: string;
  section: Pick<Section, "id" | "attendanceMode" | "weeklyOff">;
  employees: Emp[];
  dates: ISODate[];
  rules: AttendanceRules;
  today: ISODate;
  pending?: Map<string, DayStatus | null>;
  tx?: DbLike;
}

async function buildRows(input: BuildInput): Promise<RegisterRow[]> {
  const { dates, employees, rules } = input;
  const from = dates[0];
  const to = dates[dates.length - 1];
  const ids = employees.map((e) => e.id);
  const [holidays, punches, saved, leaveTypes] = await Promise.all([
    gazettedHolidays(input.boardId, from, to, input.tx),
    punchesBetween(ids, from, to, input.tx),
    savedBetween(ids, from, to, input.tx),
    (input.tx ?? db).leaveType.findMany({ where: { boardId: input.boardId }, select: { code: true, pay: true } }),
  ]);
  const leavePay = new Map(leaveTypes.map((l) => [l.code, l.pay]));
  const weeklyOff = weeklyOffFor(input.section.weeklyOff, rules.weeklyOff);
  const holidaySet = new Set(holidays.keys());
  return employees.map((e) => {
    const days: RegisterDay[] = dates.map((date) => {
      const key = `${e.id}|${date}`;
      const s = saved.get(key);
      const resolved = resolveDay({
        date,
        today: input.today,
        onRollFrom: toISODate(e.dateOfJoining),
        onRollTo: e.exitDate ? toISODate(e.exitDate) : null,
        mode: input.section.attendanceMode,
        calendar: calendarDay(date, holidaySet, weeklyOff),
        saved: s ? { status: s.status, half: s.half, checked: s.checked, leaveCode: s.leaveCode } : null,
        punches: punches.get(key) ?? [],
        rules,
      });
      if (s?.firstIn) {
        resolved.firstIn = s.firstIn;
        resolved.lastOut = s.lastOut;
        resolved.workedMinutes = s.workedMinutes;
      }
      const day: RegisterDay = { ...resolved, date, holidayName: holidays.get(date)?.name };
      if (input.pending?.has(key)) day.pending = input.pending.get(key) ?? "CLEAR";
      return day;
    });
    return {
      employee: {
        id: e.id,
        code: e.employeeCode ?? "",
        name: fullName(e),
        nameHi: e.nameHi,
        post: e.post.name,
        postHi: e.post.nameHi,
        type: e.type,
        biometricId: e.biometricId,
      },
      days,
      totals: monthTotals(days, leavePay),
    };
  });
}

interface MusterPayload {
  sectionId: string;
  month: string;
  entries: { employeeId: string; date: ISODate; status: DayStatus | null }[];
}

async function pendingMuster(boardId: string, sectionId: string, month: string, tx: DbLike = db) {
  const tasks = await tx.approvalTask.findMany({ where: { boardId, kind: "attendance.muster", status: "PENDING", entityType: "AttendanceMuster", entityId: `${sectionId}:${month}` } });
  return tasks[0] ?? null;
}

/** S-30: one section's month — every person, every day, with totals. */
export async function sectionRegister(actor: Actor, sectionId: string, month: string) {
  if (!canViewSection(actor, sectionId)) throw forbidden();
  const section = await db.section.findFirst({ where: { id: sectionId, boardId: actor.boardId } });
  if (!section) throw notFound();
  const today = todayIST();
  const rules = await attendanceRules(actor.boardId);
  const { dates, from, to } = monthRange(month);
  const employees = await employeesOn(actor.boardId, { sectionId }, from, to);
  const task = await pendingMuster(actor.boardId, sectionId, month);
  const pending = new Map<string, DayStatus | null>();
  if (task) for (const e of (task.payload as unknown as MusterPayload).entries) pending.set(`${e.employeeId}|${e.date}`, e.status);
  const rows = await buildRows({ boardId: actor.boardId, section, employees, dates, rules, today, pending });
  const lock = await lockOf(actor.boardId, sectionId, month);
  const holidays = await gazettedHolidays(actor.boardId, from, to);
  const openRequests = await db.attendanceRequest.count({
    where: { boardId: actor.boardId, status: "PENDING", employeeId: { in: employees.map((e) => e.id) }, date: { gte: fromISODate(from), lte: fromISODate(to) } },
  });
  return {
    section,
    month,
    dates,
    today,
    rows,
    lock,
    pendingMusterTaskId: task?.id ?? null,
    openRequests,
    holidays: [...holidays.values()].map((h) => ({ date: toISODate(h.date), name: h.name, nameHi: h.nameHi })),
    weeklyOff: weeklyOffFor(section.weeklyOff, rules.weeklyOff),
    canEdit: canEnterMuster(actor) && !lock && !task && from <= today,
    canLock: canLockSection(actor, sectionId) && !lock && to < today,
  };
}

/** Sections the actor may see, for pickers. */
export async function visibleSections(actor: Actor) {
  const scope = sectionScope(actor);
  if (!scope) return [];
  return db.section.findMany({ where: { boardId: actor.boardId, isActive: true, ...(scope === "all" ? {} : { id: scope }) }, orderBy: { name: "asc" } });
}

// ─── Today board (AT-07) ───────────────────────────────────────────────────────

export interface TodayCounts {
  staff: number;
  present: number;
  late: number;
  notIn: number;
  onLeave: number;
  onDuty: number;
  off: number;
  unmarked: number;
}

/** AT-07: present, late, not in, on leave and on duty today, by section. */
export async function todayBoard(actor: Actor) {
  const scope = sectionScope(actor);
  if (!scope) throw forbidden();
  const today = todayIST();
  const rules = await attendanceRules(actor.boardId);
  const sections = await visibleSections(actor);
  const employees = await employeesOn(actor.boardId, scope === "all" ? {} : { sectionId: scope }, today, today);
  const holidays = await gazettedHolidays(actor.boardId, today, today);
  const out: { section: Section; counts: TodayCounts; people: { id: string; code: string; name: string; nameHi: string | null; status: DayStatus | null; firstIn: Date | null }[] }[] = [];
  for (const section of sections) {
    const staff = employees.filter((e) => e.sectionId === section.id);
    if (staff.length === 0) continue;
    const rows = await buildRows({ boardId: actor.boardId, section, employees: staff, dates: [today], rules, today });
    const counts: TodayCounts = { staff: staff.length, present: 0, late: 0, notIn: 0, onLeave: 0, onDuty: 0, off: 0, unmarked: 0 };
    for (const r of rows) {
      const d = r.days[0];
      if (d.status === "PRESENT" || d.status === "HALF_DAY") counts.present += 1;
      else if (d.status === "LATE") {
        counts.present += 1;
        counts.late += 1;
      } else if (d.status === "LEAVE") counts.onLeave += 1;
      else if (d.status === "ON_DUTY") counts.onDuty += 1;
      else if (d.status === "HOLIDAY" || d.status === "WEEKLY_OFF") counts.off += 1;
      else if (section.attendanceMode === "MANUAL") counts.unmarked += 1;
      else counts.notIn += 1;
    }
    out.push({ section, counts, people: rows.map((r) => ({ id: r.employee.id, code: r.employee.code, name: r.employee.name, nameHi: r.employee.nameHi, status: r.days[0].status, firstIn: r.days[0].firstIn })) });
  }
  const total = out.reduce<TodayCounts>(
    (t, s) => ({
      staff: t.staff + s.counts.staff,
      present: t.present + s.counts.present,
      late: t.late + s.counts.late,
      notIn: t.notIn + s.counts.notIn,
      onLeave: t.onLeave + s.counts.onLeave,
      onDuty: t.onDuty + s.counts.onDuty,
      off: t.off + s.counts.off,
      unmarked: t.unmarked + s.counts.unmarked,
    }),
    { staff: 0, present: 0, late: 0, notIn: 0, onLeave: 0, onDuty: 0, off: 0, unmarked: 0 },
  );
  return { today, holiday: holidays.get(today) ?? null, sections: out, total, officeStart: rules.officeStart };
}

// ─── My attendance (Employee login) ───────────────────────────────────────────

export async function myAttendance(actor: Actor, month: string) {
  if (!actor.employeeId) throw forbidden();
  const e = await db.employee.findUnique({ where: { id: actor.employeeId }, select: { ...empSelect, section: true } });
  if (!e) throw notFound();
  const today = todayIST();
  const rules = await attendanceRules(actor.boardId);
  const { dates, from, to } = monthRange(month);
  const [row] = await buildRows({ boardId: actor.boardId, section: e.section, employees: [e], dates, rules, today });
  const requests = await db.attendanceRequest.findMany({ where: { employeeId: e.id }, orderBy: { createdAt: "desc" }, take: 30 });
  const lock = await lockOf(actor.boardId, e.sectionId, month);
  const holidays = await db.holiday.findMany({ where: { boardId: actor.boardId, date: { gte: fromISODate(from), lte: fromISODate(to) } }, orderBy: { date: "asc" } });
  return {
    month,
    today,
    row,
    lock,
    mode: e.section.attendanceMode,
    requests,
    holidays: holidays.map((h) => ({ date: toISODate(h.date), name: h.name, nameHi: h.nameHi, kind: h.kind })),
    joinedOn: toISODate(e.dateOfJoining),
    officeStart: rules.officeStart,
  };
}

// ─── Missed punch / on duty (AT-04) ───────────────────────────────────────────

/** The reporting officer of a section, if one is on the rolls and active. */
export async function sectionOfficers(boardId: string, sectionId: string, tx: DbLike = db) {
  return tx.user.findMany({
    where: { boardId, status: "ACTIVE", loginType: "EMPLOYEE", permissions: { has: "REPORTING_OFFICER" }, employee: { sectionId, status: "ACTIVE" } },
    select: { id: true, employeeId: true },
  });
}

export async function submitAttendanceRequest(actor: Actor, raw: unknown) {
  const scope = scopeFor(actor, "attendance", "create");
  if (!scope || !actor.employeeId) throw forbidden();
  const input = attendanceRequestSchema.parse(raw);
  const e = await db.employee.findUnique({ where: { id: actor.employeeId }, include: { section: true } });
  if (!e || e.status !== "ACTIVE") throw forbidden();
  const today = todayIST();
  if (input.date > today) throw badRequest("attendance.errors.future", { date: "attendance.errors.future" });
  if (input.date < toISODate(e.dateOfJoining)) throw badRequest("attendance.errors.beforeJoining", { date: "attendance.errors.beforeJoining" });
  if (input.date < `${shiftMonth(monthOf(today), -1)}-01`) throw badRequest("attendance.errors.tooOld", { date: "attendance.errors.tooOld" });
  if (input.type === "MISSED_PUNCH" && e.section.attendanceMode === "MANUAL") throw badRequest("attendance.errors.manualSection");

  return db.$transaction(async (tx) => {
    await assertUnlocked(tx, actor.boardId, e.sectionId, monthOf(input.date));
    const clash = await tx.attendanceRequest.findFirst({ where: { employeeId: e.id, date: fromISODate(input.date), status: "PENDING" } });
    if (clash) throw conflict("attendance.errors.requestPending", undefined, { date: "attendance.errors.requestPending" });
    const request = await tx.attendanceRequest.create({
      data: {
        boardId: actor.boardId,
        employeeId: e.id,
        date: fromISODate(input.date),
        type: input.type,
        inTime: input.inTime ?? null,
        outTime: input.outTime ?? null,
        reason: input.reason,
        createdById: actor.userId,
      },
    });
    // The section's reporting officer decides; their own requests (or a section without an officer) go to HR.
    const officers = (await sectionOfficers(actor.boardId, e.sectionId, tx)).filter((o) => o.employeeId !== e.id);
    const toOfficer = officers.length > 0;
    const name = fullName(e);
    const what = input.type === "MISSED_PUNCH" ? "Missed punch" : "On duty";
    const whatHi = input.type === "MISSED_PUNCH" ? "छूटा पंच" : "ड्यूटी पर";
    const task = await submitForApproval(tx, actor, {
      kind: "attendance.request",
      requiredPermission: toOfficer ? "REPORTING_OFFICER" : "HR",
      sectionId: toOfficer ? e.sectionId : null,
      title: `${what}: ${name} · ${formatDate(input.date)}`,
      titleHi: `${whatHi}: ${e.nameHi ?? name} · ${formatDate(input.date, "hi")}`,
      details: {
        rows: [
          { label: "Date", labelHi: "तारीख", new: formatDate(input.date) },
          { label: "Request", labelHi: "अनुरोध", new: what },
          ...(input.inTime ? [{ label: "In time", labelHi: "आने का समय", new: input.inTime }] : []),
          ...(input.outTime ? [{ label: "Out time", labelHi: "जाने का समय", new: input.outTime }] : []),
          { label: "Reason", labelHi: "कारण", new: input.reason },
        ],
        link: toOfficer ? `/my/team/attendance?month=${monthOf(input.date)}` : `/attendance?tab=register&section=${e.sectionId}&month=${monthOf(input.date)}`,
      } satisfies ApprovalDetails,
      payload: { requestId: request.id },
      entityType: "AttendanceRequest",
      entityId: request.id,
      subjectEmployeeId: e.id,
      note: input.reason,
    });
    await tx.attendanceRequest.update({ where: { id: request.id }, data: { taskId: task.id } });
    await audit(tx, actor, { action: "CREATE", entityType: "AttendanceRequest", entityId: request.id, summary: `${what} request for ${formatDate(input.date)}` });
    return request;
  });
}

/** Applied when the officer approves a request: the day becomes present / late / half day, or on duty. */
export async function applyAttendanceRequest(tx: Tx, actor: Actor, requestId: string) {
  const r = await tx.attendanceRequest.findUniqueOrThrow({ where: { id: requestId } });
  const e = await tx.employee.findUniqueOrThrow({ where: { id: r.employeeId } });
  const date = toISODate(r.date);
  await assertUnlocked(tx, r.boardId, e.sectionId, monthOf(date));
  let data: Pick<AttendanceDay, "status" | "firstIn" | "lastOut" | "workedMinutes">;
  if (r.type === "ON_DUTY") data = { status: "ON_DUTY", firstIn: null, lastOut: null, workedMinutes: null };
  else {
    const rules = await attendanceRules(r.boardId, tx);
    const existing = (await punchesBetween([e.id], date, date, tx)).get(`${e.id}|${date}`) ?? [];
    const given = [r.inTime, r.outTime].filter((t): t is string => !!t).map((t) => istInstant(date, t));
    const result = statusFromPunches([...existing, ...given], rules);
    // A single known time with nothing else on the day still leaves the other end unknown: treat as present.
    data = result && result.status !== "MISSED_PUNCH" ? result : { status: "PRESENT", firstIn: given[0] ?? existing[0] ?? null, lastOut: null, workedMinutes: null };
  }
  await tx.attendanceDay.upsert({
    where: { employeeId_date: { employeeId: e.id, date: r.date } },
    create: { boardId: r.boardId, employeeId: e.id, date: r.date, ...data, source: "REQUEST", note: r.reason, updatedById: actor.userId },
    update: { ...data, source: "REQUEST", note: r.reason, half: false, leaveCode: null, checked: true, updatedById: actor.userId },
  });
  await tx.attendanceRequest.update({ where: { id: r.id }, data: { status: "APPROVED", decidedAt: new Date() } });
  await emit(tx, r.boardId, "attendance.day_regularised", { type: "AttendanceDay", id: `${e.id}:${date}` }, { employeeId: e.id, date, status: data.status });
}

// ─── Manual muster and HR corrections (AT-02) ─────────────────────────────────

export async function submitMuster(actor: Actor, raw: unknown) {
  if (!canEnterMuster(actor)) throw forbidden();
  const input = musterSchema.parse(raw);
  const section = await db.section.findFirst({ where: { id: input.sectionId, boardId: actor.boardId } });
  if (!section) throw notFound();
  const today = todayIST();
  const { from, to } = monthRange(input.month);
  const employees = await employeesOn(actor.boardId, { sectionId: section.id }, from, to);
  const byId = new Map(employees.map((e) => [e.id, e]));
  const seen = new Set<string>();
  for (const entry of input.entries) {
    const e = byId.get(entry.employeeId);
    if (!e) throw badRequest("attendance.errors.notInSection");
    if (monthOf(entry.date) !== input.month || entry.date > today) throw badRequest("attendance.errors.future");
    if (entry.date < toISODate(e.dateOfJoining) || (e.exitDate && entry.date > toISODate(e.exitDate))) throw badRequest("attendance.errors.notOnRolls");
    const key = `${entry.employeeId}|${entry.date}`;
    if (seen.has(key)) throw badRequest("attendance.errors.duplicateEntry");
    seen.add(key);
  }

  return db.$transaction(async (tx) => {
    await assertUnlocked(tx, actor.boardId, section.id, input.month);
    if (await pendingMuster(actor.boardId, section.id, input.month, tx)) throw conflict("attendance.errors.musterPending");
    const saved = await savedBetween([...new Set(input.entries.map((x) => x.employeeId))], from, to, tx);
    const rows = input.entries
      .slice()
      .sort((a, b) => (a.date === b.date ? byId.get(a.employeeId)!.employeeCode!.localeCompare(byId.get(b.employeeId)!.employeeCode!) : a.date.localeCompare(b.date)))
      .map((x) => {
        const e = byId.get(x.employeeId)!;
        const before = saved.get(`${x.employeeId}|${x.date}`);
        return {
          label: `${e.employeeCode} ${fullName(e)} · ${formatDate(x.date)}`,
          old: before ? STATUS_EN[before.status] : null,
          new: x.status ? STATUS_EN[x.status] : "Clear (use punches / calendar)",
        };
      });
    const task = await submitForApproval(tx, actor, {
      kind: "attendance.muster",
      title: `Attendance entries: ${section.name} · ${formatMonth(input.month)} (${input.entries.length})`,
      titleHi: `उपस्थिति प्रविष्टियाँ: ${section.nameHi} · ${formatMonth(input.month, "hi")} (${input.entries.length})`,
      details: { rows: rows.slice(0, 200), link: `/attendance?tab=register&section=${section.id}&month=${input.month}`, summary: rows.length > 200 ? `First 200 of ${rows.length} entries shown.` : undefined } satisfies ApprovalDetails,
      payload: { sectionId: section.id, month: input.month, entries: input.entries } satisfies MusterPayload,
      entityType: "AttendanceMuster",
      entityId: `${section.id}:${input.month}`,
      note: input.note,
    });
    await audit(tx, actor, { action: "SUBMIT", entityType: "AttendanceMuster", entityId: `${section.id}:${input.month}`, summary: `Sent ${input.entries.length} attendance entries for ${section.name}, ${formatMonth(input.month)} to the Checker` });
    return task;
  });
}

/** Applied when the Checker approves a muster batch. */
export async function applyMuster(tx: Tx, actor: Actor, payload: MusterPayload, makerId: string) {
  await assertUnlocked(tx, actor.boardId, payload.sectionId, payload.month);
  for (const entry of payload.entries) {
    const date = fromISODate(entry.date);
    if (entry.status === null) {
      await tx.attendanceDay.deleteMany({ where: { employeeId: entry.employeeId, date, source: "MUSTER" } });
      continue;
    }
    await tx.attendanceDay.upsert({
      where: { employeeId_date: { employeeId: entry.employeeId, date } },
      create: { boardId: actor.boardId, employeeId: entry.employeeId, date, status: entry.status, source: "MUSTER", updatedById: makerId },
      update: { status: entry.status, source: "MUSTER", half: false, leaveCode: null, checked: true, firstIn: null, lastOut: null, workedMinutes: null, updatedById: makerId },
    });
  }
  await emit(tx, actor.boardId, "attendance.muster_checked", { type: "AttendanceMuster", id: `${payload.sectionId}:${payload.month}` }, { entries: payload.entries.length });
}

// ─── Month lock (AT-05) ───────────────────────────────────────────────────────

export interface LockBlockers {
  monthNotOver: boolean;
  pendingRequests: number;
  pendingMuster: boolean;
  unmarked: number;
}

/** What stands between a section's month and its lock, and the days the officer must decide. */
export async function lockPreview(actor: Actor, sectionId: string, month: string) {
  if (!canLockSection(actor, sectionId) && !canViewSection(actor, sectionId)) throw forbidden();
  const reg = await sectionRegister(actor, sectionId, month);
  const exceptions = reg.rows.flatMap((r) =>
    r.days.filter((d) => d.status && EXCEPTION_STATUSES.includes(d.status) && d.pending === undefined).map((d) => ({ employeeId: r.employee.id, code: r.employee.code, name: r.employee.name, nameHi: r.employee.nameHi, date: d.date, status: d.status!, firstIn: d.firstIn, lastOut: d.lastOut })),
  );
  const blockers: LockBlockers = {
    monthNotOver: datesOfMonth(month).at(-1)! >= reg.today,
    pendingRequests: reg.openRequests,
    pendingMuster: !!reg.pendingMusterTaskId,
    unmarked: reg.rows.reduce((n, r) => n + r.totals.unmarked, 0),
  };
  // Leave each person could have the day treated as (AT-05: "goes to leave or dies-non").
  const people = [...new Set(exceptions.map((x) => x.employeeId))];
  const staff = await db.employee.findMany({ where: { id: { in: people } }, select: { id: true, gender: true, type: true } });
  const leaveChoices: Record<string, { code: string; name: string; nameHi: string; available: number | null }[]> = {};
  for (const e of staff) {
    leaveChoices[e.id] = (await balancesFor(e, actor.boardId))
      .filter((b) => b.creditMode === "HALF_YEARLY" || b.creditMode === "YEARLY" || (b.creditMode === "NONE" && !b.debitFrom))
      .filter((b) => b.code !== "RH")
      .map((b) => ({ code: b.code, name: b.name, nameHi: b.nameHi, available: b.available }));
  }
  return { ...reg, exceptions, blockers, leaveChoices };
}

export async function lockMonth(actor: Actor, raw: unknown) {
  const input = lockSchema.parse(raw);
  if (!canLockSection(actor, input.sectionId)) throw forbidden();
  const preview = await lockPreview(actor, input.sectionId, input.month);
  if (preview.lock) throw conflict("attendance.errors.alreadyLocked");
  const b = preview.blockers;
  if (b.monthNotOver) throw badRequest("attendance.errors.monthNotOver");
  if (b.pendingRequests) throw badRequest("attendance.errors.requestsOpen", undefined, { count: b.pendingRequests });
  if (b.pendingMuster) throw badRequest("attendance.errors.musterPending");
  if (b.unmarked) throw badRequest("attendance.errors.unmarked", undefined, { count: b.unmarked });
  const decided = new Map(input.resolutions.map((r) => [`${r.employeeId}|${r.date}`, r]));
  const missing = preview.exceptions.filter((x) => !decided.has(`${x.employeeId}|${x.date}`));
  if (missing.length) throw badRequest("attendance.errors.undecided", undefined, { count: missing.length });
  const exceptionKeys = new Set(preview.exceptions.map((x) => `${x.employeeId}|${x.date}`));
  if (input.resolutions.some((r) => !exceptionKeys.has(`${r.employeeId}|${r.date}`))) throw badRequest("attendance.errors.notAnException");

  const exceptionStatus = new Map(preview.exceptions.map((x) => [`${x.employeeId}|${x.date}`, x.status]));
  // Days treated as leave must fit the person's balance.
  const leaveTypes = new Map((await leaveRules(actor.boardId)).map((t) => [t.code, t]));
  const need = new Map<string, number>();
  for (const r of input.resolutions.filter((x) => x.outcome === "LEAVE")) {
    const choice = preview.leaveChoices[r.employeeId]?.find((c) => c.code === r.leaveCode);
    if (!choice) throw badRequest("attendance.errors.leaveNotAllowed", undefined, { code: r.leaveCode ?? "" });
    const share = exceptionStatus.get(`${r.employeeId}|${r.date}`) === "HALF_DAY" ? 0.5 : 1;
    need.set(`${r.employeeId}|${r.leaveCode}`, (need.get(`${r.employeeId}|${r.leaveCode}`) ?? 0) + share);
  }
  for (const [key, days] of need) {
    const [employeeId, code] = key.split("|");
    const available = preview.leaveChoices[employeeId].find((c) => c.code === code)!.available;
    if (available !== null && days > available) throw badRequest("attendance.errors.leaveShort", undefined, { code, days, available });
  }

  return db.$transaction(async (tx) => {
    await assertUnlocked(tx, actor.boardId, input.sectionId, input.month);
    let diesNon = 0;
    for (const row of preview.rows) {
      for (const d of row.days) {
        if (!d.onRoll || !d.status) continue;
        const key = `${row.employee.id}|${d.date}`;
        const r = decided.get(key);
        let status: DayStatus = d.status;
        let half = d.half;
        let source: AttendanceDay["source"] = d.from === "punches" ? "DEVICE" : "LOCK";
        let note: string | null | undefined;
        let leaveCode: string | null = null;
        if (r) {
          // A half day confirmed as dies-non (or leave) is half a day of it; the other half was worked.
          half = (r.outcome === "DIES_NON" || r.outcome === "LEAVE") && exceptionStatus.get(key) === "HALF_DAY";
          status = r.outcome;
          source = "LOCK";
          note = r.note ?? null;
          if (r.outcome === "DIES_NON") diesNon += half ? 0.5 : 1;
          if (r.outcome === "LEAVE") {
            const type = leaveTypes.get(r.leaveCode!)!;
            leaveCode = type.code;
            await tx.leaveLedger.create({
              data: {
                boardId: actor.boardId,
                employeeId: row.employee.id,
                leaveCode: type.debitFrom ?? type.code,
                date: fromISODate(d.date),
                kind: "DEBIT",
                days: -(half ? 0.5 : 1) * type.debitFactor,
                note: `Unexplained day treated as ${type.code} at the month lock`,
                createdById: actor.userId,
              },
            });
          }
        } else if (d.from === "saved") continue; // already a saved row
        const date = fromISODate(d.date);
        await tx.attendanceDay.upsert({
          where: { employeeId_date: { employeeId: row.employee.id, date } },
          create: { boardId: actor.boardId, employeeId: row.employee.id, date, status, half, source, leaveCode, note: note ?? null, firstIn: d.firstIn, lastOut: d.lastOut, workedMinutes: d.workedMinutes, updatedById: actor.userId },
          update: { status, half, source, leaveCode, note: note ?? null, updatedById: actor.userId },
        });
      }
    }
    // Freeze the totals payroll reads.
    const employees = preview.rows.map((r) => r.employee.id);
    const section = preview.section;
    const rules = await attendanceRules(actor.boardId, tx);
    const fresh = await buildRows({
      boardId: actor.boardId,
      section,
      employees: await employeesOn(actor.boardId, { id: { in: employees } }, preview.dates[0], preview.dates.at(-1)!, tx),
      dates: preview.dates,
      rules,
      today: preview.today,
      tx,
    });
    await tx.attendanceMonth.deleteMany({ where: { employeeId: { in: employees }, month: input.month } });
    await tx.attendanceMonth.createMany({
      data: fresh.map((r) => ({
        boardId: actor.boardId,
        employeeId: r.employee.id,
        sectionId: section.id,
        month: input.month,
        daysInMonth: r.totals.daysInMonth,
        daysOnRoll: r.totals.daysOnRoll,
        present: r.totals.present,
        late: r.totals.late,
        halfDays: r.totals.halfDays,
        onDuty: r.totals.onDuty,
        leave: r.totals.leave,
        holidays: r.totals.holidays,
        weeklyOffs: r.totals.weeklyOffs,
        diesNon: r.totals.diesNon,
        halfPayLeave: r.totals.halfPayLeave,
        noPayLeave: r.totals.noPayLeave,
        payableDays: r.totals.payableDays,
        workedDays: r.totals.workedDays,
      })),
    });
    const lock = await tx.attendanceLock.upsert({
      where: { boardId_sectionId_month: { boardId: actor.boardId, sectionId: section.id, month: input.month } },
      create: { boardId: actor.boardId, sectionId: section.id, month: input.month, lockedById: actor.userId, lockedByName: actor.name },
      update: { lockedById: actor.userId, lockedByName: actor.name, lockedAt: new Date(), unlockedAt: null, unlockNote: null },
    });
    await audit(tx, actor, {
      action: "LOCK",
      entityType: "AttendanceLock",
      entityId: lock.id,
      summary: `Locked ${section.name} attendance for ${formatMonth(input.month)} (${input.resolutions.length} days decided, ${diesNon} dies-non)`,
      newValue: { resolutions: input.resolutions },
    });
    await emit(tx, actor.boardId, "attendance.month_locked", { type: "AttendanceLock", id: lock.id }, { sectionId: section.id, month: input.month, employees: employees.length });
    return lock;
  });
}

/** HR asks to reopen a locked month; a Checker decides (payroll will refuse once it has used the month). */
export async function requestUnlock(actor: Actor, raw: unknown) {
  const input = unlockSchema.parse(raw);
  if (scopeFor(actor, "attendance", "lock") !== "all") throw forbidden();
  const section = await db.section.findFirst({ where: { id: input.sectionId, boardId: actor.boardId } });
  if (!section) throw notFound();
  return db.$transaction(async (tx) => {
    const lock = await lockOf(actor.boardId, section.id, input.month, tx);
    if (!lock) throw badRequest("attendance.errors.notLocked");
    if ((await pendingFor(actor.boardId, "AttendanceLock", lock.id, ["attendance.unlock"], tx)).length) throw conflict("attendance.errors.unlockPending");
    const task = await submitForApproval(tx, actor, {
      kind: "attendance.unlock",
      title: `Reopen attendance: ${section.name} · ${formatMonth(input.month)}`,
      titleHi: `उपस्थिति फिर खोलें: ${section.nameHi} · ${formatMonth(input.month, "hi")}`,
      details: {
        rows: [
          { label: "Locked by", labelHi: "लॉक करने वाले", new: `${lock.lockedByName} · ${formatDate(toISODate(lock.lockedAt))}` },
          { label: "Reason", labelHi: "कारण", new: input.reason },
        ],
        link: `/attendance?tab=register&section=${section.id}&month=${input.month}`,
      } satisfies ApprovalDetails,
      payload: { lockId: lock.id },
      entityType: "AttendanceLock",
      entityId: lock.id,
      note: input.reason,
    });
    await audit(tx, actor, { action: "SUBMIT", entityType: "AttendanceLock", entityId: lock.id, summary: `Asked to reopen ${section.name} attendance for ${formatMonth(input.month)}` });
    return task;
  });
}

/** Lock status of every visible section for a month — the Locks tab and Home tiles. */
export async function lockOverview(actor: Actor, month: string) {
  const scope = sectionScope(actor);
  if (!scope) throw forbidden();
  const sections = await visibleSections(actor);
  const locks = await db.attendanceLock.findMany({ where: { boardId: actor.boardId, month, unlockedAt: null } });
  const byId = new Map(locks.map((l) => [l.sectionId, l]));
  const counts = await db.employee.groupBy({ by: ["sectionId"], where: { boardId: actor.boardId, ...ON_ROLLS, status: { in: ["ACTIVE", "SUSPENDED"] } }, _count: true });
  const staff = new Map(counts.map((c) => [c.sectionId, c._count]));
  return sections.map((s) => ({ section: s, lock: byId.get(s.id) ?? null, staff: staff.get(s.id) ?? 0, canLock: canLockSection(actor, s.id) }));
}

/** Locks due for the actor (Home "My work"): last month, by the lock day. */
export async function locksDue(actor: Actor) {
  const scope = scopeFor(actor, "attendance", "lock");
  if (!scope) return null;
  const rules = await attendanceRules(actor.boardId);
  const due = lockDue(todayIST(), rules.lockDay);
  const overview = await lockOverview(actor, due.month);
  const open = overview.filter((o) => o.canLock && !o.lock && o.staff > 0);
  return { ...due, open: open.map((o) => o.section) };
}

// ─── Section rules ────────────────────────────────────────────────────────────

export async function updateSectionRules(actor: Actor, sectionId: string, raw: unknown) {
  if (!canEnterMuster(actor)) throw forbidden();
  const input = sectionRulesSchema.parse(raw);
  const section = await db.section.findFirst({ where: { id: sectionId, boardId: actor.boardId } });
  if (!section) throw notFound();
  const weeklyOff = input.weeklyOff === null ? null : input.weeklyOff.length === 0 ? "-" : [...new Set(input.weeklyOff)].sort().join(",");
  return db.$transaction(async (tx) => {
    const updated = await tx.section.update({ where: { id: sectionId }, data: { attendanceMode: input.attendanceMode, weeklyOff } });
    await audit(tx, actor, {
      action: "UPDATE",
      entityType: "Section",
      entityId: sectionId,
      summary: `Changed attendance rules for ${section.name}`,
      oldValue: { attendanceMode: section.attendanceMode, weeklyOff: section.weeklyOff },
      newValue: { attendanceMode: updated.attendanceMode, weeklyOff: updated.weeklyOff },
    });
    await emit(tx, actor.boardId, "section.attendance_rules_changed", { type: "Section", id: sectionId }, { attendanceMode: updated.attendanceMode, weeklyOff: updated.weeklyOff });
    return updated;
  });
}

/** Requests waiting in a section (or all sections) for the HR list. */
export async function openRequests(actor: Actor) {
  const scope = sectionScope(actor);
  if (!scope) throw forbidden();
  const rows = await db.attendanceRequest.findMany({ where: { boardId: actor.boardId, status: "PENDING" }, orderBy: { date: "asc" }, take: 200 });
  const employees = await db.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId) } }, select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, sectionId: true, section: { select: { name: true, nameHi: true } } } });
  const byId = new Map(employees.map((e) => [e.id, e]));
  return rows
    .map((r) => ({ ...r, employee: byId.get(r.employeeId)! }))
    .filter((r) => r.employee && (scope === "all" || r.employee.sectionId === scope));
}
