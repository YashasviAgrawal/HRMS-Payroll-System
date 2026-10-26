/**
 * Attendance rules (PRD §6) as pure functions, shared by the service, the screens and the tests.
 *
 * A day's status comes from, in order of strength:
 *   1. a saved row (muster, approved request, leave, officer's decision at lock);
 *   2. the calendar (holiday, weekly off);
 *   3. punches (present, late, half day, missed punch);
 *   4. nothing at all — absent for a device section once the day is over, "not marked" for a manual one.
 */
import type { DayStatus } from "@/generated/prisma/enums";
import { istMinutes, weekday, type ISODate } from "@/lib/dates";

export interface AttendanceRules {
  officeStart: string;
  graceMinutes: number;
  halfDayMinutes: number;
  weeklyOff: number[];
}

/** Statuses an officer must decide before the month can be locked (AT-05). */
export const EXCEPTION_STATUSES: readonly DayStatus[] = ["ABSENT", "MISSED_PUNCH", "HALF_DAY"];

/** Statuses HR may enter in the muster (AT-02). Leave comes from the Leave module, holidays from the calendar. */
export const MUSTER_STATUSES = ["PRESENT", "LATE", "HALF_DAY", "ABSENT", "ON_DUTY"] as const;
export type MusterStatus = (typeof MUSTER_STATUSES)[number];

/** What an officer may decide for an unexplained day at lock. Leave joins this list with the Leave module. */
export const RESOLUTIONS = ["PRESENT", "ON_DUTY", "DIES_NON"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** Short codes for the month register, printed the way muster rolls are written. */
export const STATUS_CODE: Record<DayStatus, string> = {
  PRESENT: "P",
  LATE: "L",
  HALF_DAY: "½",
  ABSENT: "A",
  MISSED_PUNCH: "M",
  ON_DUTY: "OD",
  LEAVE: "LV",
  HOLIDAY: "H",
  WEEKLY_OFF: "W",
  DIES_NON: "DN",
};

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** "0,6" → [0, 6]; null or empty follows the Board setting. */
export function weeklyOffFor(sectionWeeklyOff: string | null | undefined, boardDefault: number[]): number[] {
  if (sectionWeeklyOff == null || sectionWeeklyOff.trim() === "") return boardDefault;
  if (sectionWeeklyOff.trim() === "-") return [];
  return sectionWeeklyOff
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isInteger(x) && x >= 0 && x <= 6);
}

export interface PunchDay {
  status: DayStatus;
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number | null;
}

/**
 * Status from the punches of one working day. One punch (or punches within a minute of each other) is a
 * missed punch; less than the half-day time between first and last punch is a half day; a first punch
 * after office start + grace is late.
 */
export function statusFromPunches(punches: Date[], rules: AttendanceRules): PunchDay | null {
  if (punches.length === 0) return null;
  const sorted = [...punches].sort((a, b) => a.getTime() - b.getTime());
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const worked = Math.floor((last.getTime() - first.getTime()) / 60_000);
  if (sorted.length === 1 || worked < 1) return { status: "MISSED_PUNCH", firstIn: first, lastOut: null, workedMinutes: null };
  if (worked < rules.halfDayMinutes) return { status: "HALF_DAY", firstIn: first, lastOut: last, workedMinutes: worked };
  const late = istMinutes(first) > hhmmToMinutes(rules.officeStart) + rules.graceMinutes;
  return { status: late ? "LATE" : "PRESENT", firstIn: first, lastOut: last, workedMinutes: worked };
}

export interface CalendarDay {
  holiday: boolean;
  weeklyOff: boolean;
}

export function calendarDay(date: ISODate, holidays: Set<ISODate>, weeklyOff: number[]): CalendarDay {
  return { holiday: holidays.has(date), weeklyOff: weeklyOff.includes(weekday(date)) };
}

export interface DayInput {
  date: ISODate;
  today: ISODate;
  /** Date of joining and exit — days outside are not on the rolls. */
  onRollFrom: ISODate;
  onRollTo: ISODate | null;
  mode: "DEVICE" | "MANUAL";
  calendar: CalendarDay;
  saved?: { status: DayStatus; half?: boolean; checked?: boolean } | null;
  punches: Date[];
  rules: AttendanceRules;
}

export interface ResolvedDay {
  /** Null when the person was not on the rolls, the day is in the future, or a manual section has not marked it yet. */
  status: DayStatus | null;
  onRoll: boolean;
  /** A manual-section working day in the past with nothing entered. */
  unmarked: boolean;
  /** Where the status came from. */
  from: "saved" | "calendar" | "punches" | "none";
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number | null;
  half: boolean;
  checked: boolean;
}

export function resolveDay(input: DayInput): ResolvedDay {
  const base = { firstIn: null, lastOut: null, workedMinutes: null, half: false, checked: true };
  const onRoll = input.date >= input.onRollFrom && (input.onRollTo === null || input.date <= input.onRollTo);
  if (!onRoll) return { ...base, status: null, onRoll: false, unmarked: false, from: "none" };
  const fromPunches = statusFromPunches(input.punches, input.rules);
  if (input.saved) {
    return {
      ...base,
      firstIn: fromPunches?.firstIn ?? null,
      lastOut: fromPunches?.lastOut ?? null,
      workedMinutes: fromPunches?.workedMinutes ?? null,
      status: input.saved.status,
      half: input.saved.half ?? false,
      checked: input.saved.checked ?? true,
      onRoll,
      unmarked: false,
      from: "saved",
    };
  }
  if (input.calendar.holiday) return { ...base, ...pick(fromPunches), status: "HOLIDAY", onRoll, unmarked: false, from: "calendar" };
  if (input.calendar.weeklyOff) return { ...base, ...pick(fromPunches), status: "WEEKLY_OFF", onRoll, unmarked: false, from: "calendar" };
  if (input.date > input.today) return { ...base, status: null, onRoll, unmarked: false, from: "none" };
  if (fromPunches) {
    // Today is not over: whoever has punched in is present (or late); half days and missed punches show tomorrow.
    const status: DayStatus = input.date === input.today ? (lateAt(fromPunches.firstIn!, input.rules) ? "LATE" : "PRESENT") : fromPunches.status;
    return { ...base, ...fromPunches, status, onRoll, unmarked: false, from: "punches" };
  }
  if (input.date === input.today) return { ...base, status: null, onRoll, unmarked: false, from: "none" };
  if (input.mode === "MANUAL") return { ...base, status: null, onRoll, unmarked: true, from: "none" };
  return { ...base, status: "ABSENT", onRoll, unmarked: false, from: "none" };
}

function pick(p: PunchDay | null) {
  return p ? { firstIn: p.firstIn, lastOut: p.lastOut, workedMinutes: p.workedMinutes } : {};
}

function lateAt(at: Date, rules: AttendanceRules) {
  return istMinutes(at) > hhmmToMinutes(rules.officeStart) + rules.graceMinutes;
}

export interface MonthTotals {
  daysInMonth: number;
  daysOnRoll: number;
  present: number;
  late: number;
  halfDays: number;
  onDuty: number;
  leave: number;
  holidays: number;
  weeklyOffs: number;
  diesNon: number;
  absent: number;
  missedPunch: number;
  unmarked: number;
  payableDays: number;
  workedDays: number;
}

/**
 * Month totals. A half day counts as half present; a half-day dies-non removes half a day from pay.
 * Payable days = days on the rolls − dies-non. Worked days = present + late + on duty (half days as ½).
 */
export function monthTotals(days: ResolvedDay[]): MonthTotals {
  const t: MonthTotals = {
    daysInMonth: days.length,
    daysOnRoll: 0,
    present: 0,
    late: 0,
    halfDays: 0,
    onDuty: 0,
    leave: 0,
    holidays: 0,
    weeklyOffs: 0,
    diesNon: 0,
    absent: 0,
    missedPunch: 0,
    unmarked: 0,
    payableDays: 0,
    workedDays: 0,
  };
  for (const d of days) {
    if (!d.onRoll) continue;
    t.daysOnRoll += 1;
    if (d.unmarked) t.unmarked += 1;
    const share = d.half ? 0.5 : 1;
    switch (d.status) {
      case "PRESENT":
        t.present += 1;
        break;
      case "LATE":
        t.present += 1;
        t.late += 1;
        break;
      case "HALF_DAY":
        t.present += 0.5;
        t.halfDays += 1;
        break;
      case "ON_DUTY":
        t.onDuty += 1;
        break;
      case "LEAVE":
        t.leave += share;
        if (d.half) t.present += 0.5;
        break;
      case "HOLIDAY":
        t.holidays += 1;
        break;
      case "WEEKLY_OFF":
        t.weeklyOffs += 1;
        break;
      case "DIES_NON":
        t.diesNon += share;
        if (d.half) t.present += 0.5;
        break;
      case "ABSENT":
        t.absent += 1;
        break;
      case "MISSED_PUNCH":
        t.missedPunch += 1;
        break;
      default:
        break;
    }
  }
  t.workedDays = t.present + t.onDuty;
  t.payableDays = t.daysOnRoll - t.diesNon;
  return t;
}
