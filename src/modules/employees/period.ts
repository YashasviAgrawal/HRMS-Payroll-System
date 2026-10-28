/**
 * Client add-on: the one-screen employee view for a chosen month or financial year (April to March). Pure rules —
 * shared by the service, the screen and the tests.
 */
import { financialYear, isMonth, shiftMonth, type ISODate } from "@/lib/dates";

export type Period = { view: "month"; month: string } | { view: "year"; fy: string };

const FY_RE = /^(\d{4})-(\d{2})$/;

/** "2026-27" → "2026-04" … "2027-03", stopping at `until` (the current month) when given. */
export function monthsOfFy(fy: string, until?: string): string[] {
  const start = Number(fy.slice(0, 4));
  const out: string[] = [];
  for (let m = `${start}-04`; m <= `${start + 1}-03`; m = shiftMonth(m, 1)) {
    if (until && m > until) break;
    out.push(m);
  }
  return out;
}

export const fyOfMonth = (month: string) => financialYear(`${month}-01`);

/** Financial years from the one the person joined in to this one, newest first. */
export function fyList(from: ISODate, today: ISODate): string[] {
  const first = Number(financialYear(from).slice(0, 4));
  const last = Number(financialYear(today).slice(0, 4));
  const out: string[] = [];
  for (let y = last; y >= Math.max(first, last - 40); y--) out.push(`${y}-${String((y + 1) % 100).padStart(2, "0")}`);
  return out;
}

/** Calendar years from the year of joining to this one, newest first (leave is credited by calendar year). */
export function yearList(from: ISODate, today: ISODate): number[] {
  const out: number[] = [];
  for (let y = Number(today.slice(0, 4)); y >= Math.max(Number(from.slice(0, 4)), Number(today.slice(0, 4)) - 40); y--) out.push(y);
  return out;
}

/**
 * The period asked for in the address (`view=month&month=2026-09` or `view=year&fy=2025-26`), kept within the
 * person's service and today; anything else is "the latest" (null).
 */
export function parsePeriod(sp: { view?: string; month?: string; fy?: string }, opts: { today: ISODate; doj: ISODate }): Period | null {
  const thisMonth = opts.today.slice(0, 7);
  if (sp.view === "year" && sp.fy && FY_RE.test(sp.fy)) {
    const [, y, yy] = sp.fy.match(FY_RE)!;
    if ((Number(y) + 1) % 100 === Number(yy) && fyList(opts.doj, opts.today).includes(sp.fy)) return { view: "year", fy: sp.fy };
  }
  if (sp.month && isMonth(sp.month) && sp.month <= thisMonth && sp.month >= opts.doj.slice(0, 7)) return { view: "month", month: sp.month };
  return null;
}
