/**
 * Date helpers shared by the browser and the server.
 *
 * Business dates (birth, joining, leave, attendance) are calendar dates with no time. They are carried
 * around as ISO strings "YYYY-MM-DD" and stored in @db.Date columns, which come back as UTC midnight.
 * "Today" always means today in India (Asia/Kolkata), whatever the server's own time zone is.
 */

export type ISODate = string;

const DAY_MS = 86_400_000;

export function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Date (UTC midnight, as Prisma returns @db.Date) → "YYYY-MM-DD". */
export function toISODate(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → Date at UTC midnight, ready for a @db.Date column. */
export function fromISODate(value: ISODate): Date {
  if (!isISODate(value)) throw new Error(`Not a date: ${value}`);
  return new Date(`${value}T00:00:00Z`);
}

/** Today's date in India. */
export function todayIST(now: Date = new Date()): ISODate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

export function addDays(date: ISODate, days: number): ISODate {
  return toISODate(new Date(fromISODate(date).getTime() + days * DAY_MS));
}

export function addMonths(date: ISODate, months: number): ISODate {
  const d = fromISODate(date);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = daysInMonth(target.getUTCFullYear(), target.getUTCMonth() + 1);
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return toISODate(target);
}

export function addYears(date: ISODate, years: number): ISODate {
  return addMonths(date, years * 12);
}

/** Inclusive count of days from a to b ("2026-01-01" to "2026-01-31" → 31). */
export function daysBetweenInclusive(a: ISODate, b: ISODate): number {
  return Math.round((fromISODate(b).getTime() - fromISODate(a).getTime()) / DAY_MS) + 1;
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

export function endOfMonth(date: ISODate): ISODate {
  const d = fromISODate(date);
  return toISODate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export function startOfMonth(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

/** Whole years completed between two dates (age on a date). */
export function completedYears(from: ISODate, on: ISODate): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [oy, om, od] = on.split("-").map(Number);
  let years = oy - fy;
  if (om < fm || (om === fm && od < fd)) years -= 1;
  return years;
}

/**
 * Date of retirement (EM-02, FR 56): the last day of the month in which the employee reaches the
 * retirement age. In law a person reaches an age on the day before the birthday, so someone born on the
 * 1st of a month retires on the last day of the previous month.
 */
export function retirementDate(dateOfBirth: ISODate, retirementAge = 60): ISODate {
  const [y, m, d] = dateOfBirth.split("-").map(Number);
  const birthday = new Date(Date.UTC(y + retirementAge, m - 1, d));
  // Feb 29 births: Date.UTC rolls a missing Feb 29 forward to Mar 1, and the day before is Feb 28 — correct.
  const attains = new Date(birthday.getTime() - DAY_MS);
  return endOfMonth(toISODate(attains));
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_EN_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_HI = [
  "जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर",
];

/** "26 Oct 2026" / "26 अक्टूबर 2026". Accepts an ISO date or a Date. */
export function formatDate(value: ISODate | Date | null | undefined, lang: "en" | "hi" = "en"): string {
  if (!value) return "—";
  const iso = typeof value === "string" ? value.slice(0, 10) : toISODate(value);
  const [y, m, d] = iso.split("-").map(Number);
  const month = lang === "hi" ? MONTHS_HI[m - 1] : MONTHS_EN[m - 1];
  return `${d} ${month} ${y}`;
}

/** "2026-10" → "October 2026" / "अक्टूबर 2026". */
export function formatMonth(month: string, lang: "en" | "hi" = "en"): string {
  const [y, m] = month.split("-").map(Number);
  return `${lang === "hi" ? MONTHS_HI[m - 1] : MONTHS_EN_LONG[m - 1]} ${y}`;
}

/** Date-time in India: "26 Oct 2026, 2:05 pm". */
export function formatDateTime(value: Date | string | null | undefined, lang: "en" | "hi" = "en"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  const datePart = formatDate(todayIST(d), lang);
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return `${datePart}, ${time}`;
}

/** "YYYY-MM" of a date. */
export function monthOf(date: ISODate): string {
  return date.slice(0, 7);
}

/** Financial year label for a date: "2026-27" for any date from 1 Apr 2026 to 31 Mar 2027. */
export function financialYear(date: ISODate): string {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const IST_OFFSET_MS = 330 * 60_000;

/** A wall-clock time in India on a date → the instant. "2026-10-01", "09:05" → 2026-10-01T03:35:00Z. */
export function istInstant(date: ISODate, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(fromISODate(date).getTime() + (h * 60 + m) * 60_000 - IST_OFFSET_MS);
}

/** Minutes since midnight in India for an instant. */
export function istMinutes(at: Date): number {
  const t = new Date(at.getTime() + IST_OFFSET_MS);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

/** "09:05" in India for an instant. */
export function istTime(at: Date): string {
  const m = istMinutes(at);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: ISODate): number {
  return fromISODate(date).getUTCDay();
}

/** Every date of a month "YYYY-MM". */
export function datesOfMonth(month: string): ISODate[] {
  const [y, m] = month.split("-").map(Number);
  return Array.from({ length: daysInMonth(y, m) }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** "2026-10" + n months → "YYYY-MM". */
export function shiftMonth(month: string, n: number): string {
  return monthOf(addMonths(`${month}-01`, n));
}

export function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

