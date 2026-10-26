import "server-only";
import { pendingFor, submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db, type Tx } from "@/lib/db";
import { formatDate, fromISODate, monthOf, toISODate, type ISODate } from "@/lib/dates";
import { conflict, forbidden } from "@/lib/errors";
import { emit } from "@/lib/outbox";
import { holidayListSchema } from "./schema";
import { canEnterMuster } from "./service";

export interface HolidayInput {
  date: ISODate;
  name: string;
  nameHi: string;
  kind: "GAZETTED" | "RESTRICTED";
}

interface CalendarPayload {
  year: number;
  holidays: HolidayInput[];
}

/** S-32: anyone with attendance access (employees included) sees the year's holidays. */
export async function listHolidays(actor: Actor, year: number) {
  if (!can(actor, "attendance", "view")) throw forbidden();
  const rows = await db.holiday.findMany({ where: { boardId: actor.boardId, date: { gte: fromISODate(`${year}-01-01`), lte: fromISODate(`${year}-12-31`) } }, orderBy: [{ date: "asc" }, { kind: "asc" }] });
  const pending = await pendingFor(actor.boardId, "HolidayCalendar", String(year), ["holiday.calendar"]);
  return {
    year,
    holidays: rows.map((h) => ({ id: h.id, date: toISODate(h.date), name: h.name, nameHi: h.nameHi, kind: h.kind })),
    pending: pending[0] ? { id: pending[0].id, makerName: pending[0].makerName, createdAt: pending[0].createdAt, payload: pending[0].payload as unknown as CalendarPayload } : null,
    canEdit: canEnterMuster(actor),
  };
}

const key = (h: Pick<HolidayInput, "date" | "name" | "kind">) => `${h.date}|${h.kind}|${h.name.trim().toLowerCase()}`;

/** AT-08: HR sets the year's list; a Checker approves it before it changes anyone's attendance. */
export async function submitHolidayList(actor: Actor, raw: unknown) {
  if (!canEnterMuster(actor)) throw forbidden();
  const input = holidayListSchema.parse(raw);
  return db.$transaction(async (tx) => {
    if ((await pendingFor(actor.boardId, "HolidayCalendar", String(input.year), ["holiday.calendar"], tx)).length) throw conflict("attendance.errors.calendarPending");
    const current = await tx.holiday.findMany({ where: { boardId: actor.boardId, date: { gte: fromISODate(`${input.year}-01-01`), lte: fromISODate(`${input.year}-12-31`) } } });
    const before = new Map(current.map((h) => [key({ date: toISODate(h.date), name: h.name, kind: h.kind }), h]));
    const after = new Map(input.holidays.map((h) => [key(h), h]));
    const added = input.holidays.filter((h) => !before.has(key(h)));
    const removed = current.filter((h) => !after.has(key({ date: toISODate(h.date), name: h.name, kind: h.kind })));
    if (added.length === 0 && removed.length === 0) throw conflict("attendance.errors.noChange");
    await assertNoLockedMonths(tx, actor.boardId, [...added.filter((h) => h.kind === "GAZETTED").map((h) => h.date), ...removed.filter((h) => h.kind === "GAZETTED").map((h) => toISODate(h.date))]);
    const kindEn = (k: string) => (k === "GAZETTED" ? "Gazetted" : "Restricted");
    const rows: NonNullable<ApprovalDetails["rows"]> = [
      ...added.sort((a, b) => a.date.localeCompare(b.date)).map((h) => ({ label: `${formatDate(h.date)} · ${kindEn(h.kind)}`, old: null, new: `${h.name} / ${h.nameHi}` })),
      ...removed.map((h) => ({ label: `${formatDate(toISODate(h.date))} · ${kindEn(h.kind)}`, old: `${h.name} / ${h.nameHi}`, new: "Removed" })),
    ];
    const task = await submitForApproval(tx, actor, {
      kind: "holiday.calendar",
      title: `Holiday calendar ${input.year}: ${added.length} added, ${removed.length} removed`,
      titleHi: `अवकाश कैलेंडर ${input.year}: ${added.length} जोड़े, ${removed.length} हटाए`,
      details: {
        summary: `${input.holidays.filter((h) => h.kind === "GAZETTED").length} gazetted and ${input.holidays.filter((h) => h.kind === "RESTRICTED").length} restricted holidays after this change.`,
        summaryHi: `इस बदलाव के बाद ${input.holidays.filter((h) => h.kind === "GAZETTED").length} राजपत्रित और ${input.holidays.filter((h) => h.kind === "RESTRICTED").length} प्रतिबंधित अवकाश।`,
        rows,
        link: `/attendance/holidays?year=${input.year}`,
      } satisfies ApprovalDetails,
      payload: { year: input.year, holidays: input.holidays } satisfies CalendarPayload,
      entityType: "HolidayCalendar",
      entityId: String(input.year),
      note: input.note,
    });
    await audit(tx, actor, { action: "SUBMIT", entityType: "HolidayCalendar", entityId: String(input.year), summary: `Sent the ${input.year} holiday calendar for check (${added.length} added, ${removed.length} removed)` });
    return task;
  });
}

/** A gazetted holiday changes who was absent; months already locked for any section cannot change. */
async function assertNoLockedMonths(tx: Tx, boardId: string, dates: ISODate[]) {
  const months = [...new Set(dates.map(monthOf))];
  if (!months.length) return;
  const lock = await tx.attendanceLock.findFirst({ where: { boardId, month: { in: months }, unlockedAt: null } });
  if (lock) throw conflict("attendance.errors.holidayInLockedMonth", { month: lock.month });
}

export async function applyHolidayList(tx: Tx, boardId: string, payload: CalendarPayload) {
  const current = await tx.holiday.findMany({ where: { boardId, date: { gte: fromISODate(`${payload.year}-01-01`), lte: fromISODate(`${payload.year}-12-31`) } } });
  const after = new Set(payload.holidays.map(key));
  const before = new Set(current.map((h) => key({ date: toISODate(h.date), name: h.name, kind: h.kind })));
  const changed = [
    ...payload.holidays.filter((h) => !before.has(key(h)) && h.kind === "GAZETTED").map((h) => h.date),
    ...current.filter((h) => !after.has(key({ date: toISODate(h.date), name: h.name, kind: h.kind })) && h.kind === "GAZETTED").map((h) => toISODate(h.date)),
  ];
  await assertNoLockedMonths(tx, boardId, changed);
  await tx.holiday.deleteMany({ where: { boardId, date: { gte: fromISODate(`${payload.year}-01-01`), lte: fromISODate(`${payload.year}-12-31`) } } });
  await tx.holiday.createMany({ data: payload.holidays.map((h) => ({ boardId, date: fromISODate(h.date), name: h.name, nameHi: h.nameHi, kind: h.kind })) });
  await emit(tx, boardId, "holiday.calendar_changed", { type: "HolidayCalendar", id: String(payload.year) }, { year: payload.year, holidays: payload.holidays.length });
}
