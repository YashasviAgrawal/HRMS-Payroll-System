/**
 * Pay changes as pure rules (PR-06, PR-07) — shared by the services, the screens and the tests.
 *
 * Increments (7th CPC rule 10): one annual increment, on 1 January or 1 July. Appointment, promotion or financial
 * upgradation between 2 January and 1 July gives 1 January; between 2 July and 1 January gives 1 July. Six months of
 * qualifying service in the level are needed on the increment date.
 *
 * Fixation on promotion or MACP (7th CPC rule 13, FR 22(I)(a)(1)) — the employee chooses:
 *   FROM_PROMOTION       one increment in the old level, then the cell in the new level equal to that figure or the next
 *                        higher one; the increment date then follows the promotion date.
 *   FROM_NEXT_INCREMENT  on promotion, the cell in the new level equal to the present Basic or the next higher one; on the
 *                        date of the next increment in the old level, re-fixed: two increments in the old level (the
 *                        annual one and the promotion one), then the cell in the new level equal or next higher.
 * Both are to be confirmed with DCB Accounts (PRD §18); the rule used is shown on screen and kept with the change.
 */
import { addMonths, type ISODate } from "@/lib/dates";

export type IncrementMonth = 1 | 7;
export type FixationOption = "FROM_PROMOTION" | "FROM_NEXT_INCREMENT";

export function incrementMonthFor(date: ISODate): IncrementMonth {
  const md = Number(date.slice(5, 7)) * 100 + Number(date.slice(8, 10));
  return md >= 102 && md <= 701 ? 1 : 7;
}

/** The next 1 January / 1 July in that month, strictly after a date. */
export function nextIncrementDate(after: ISODate, month: IncrementMonth): ISODate {
  const y = Number(after.slice(0, 4));
  const mm = String(month).padStart(2, "0");
  const thisYear = `${y}-${mm}-01`;
  return thisYear > after ? thisYear : `${y + 1}-${mm}-01`;
}

/** The two increment dates around today: the latest one on or before, and the next one after. */
export function incrementDatesAround(today: ISODate): { last: ISODate; next: ISODate } {
  const y = Number(today.slice(0, 4));
  const jan = `${y}-01-01`;
  const jul = `${y}-07-01`;
  if (today >= jul) return { last: jul, next: `${y + 1}-01-01` };
  return { last: jan, next: jul };
}

/** Six months of qualifying service in the level since the last appointment, promotion or fixation. */
export function qualifies(lastChange: ISODate, due: ISODate): boolean {
  return addMonths(lastChange, 6) <= due;
}

/** Basic one step up: the next cell, or 3% rounded to ₹100 beyond the last cell (only used as a notional figure). */
function stepUp(cells: number[], index: number): number {
  return cells[index + 1] ?? Math.round((cells[cells.length - 1] * 1.03) / 100) * 100;
}

/** The cell (1-based) in a level whose pay equals the amount or is the next higher one; the last cell if none is. */
export function cellAtOrAbove(cells: number[], amount: number): number {
  const i = cells.findIndex((v) => v >= amount);
  return i === -1 ? cells.length : i + 1;
}

export interface FixationStep {
  date: ISODate;
  level: string;
  cell: number;
  basic: number;
  /** What was done: "notional" figure in the old level, then the placement. */
  from: { level: string; cell: number; basic: number; notional: number };
}

export interface Fixation {
  option: FixationOption;
  steps: FixationStep[];
  /** Increment month after the fixation. */
  incrementMonth: IncrementMonth;
}

export function fixPay(
  levels: Record<string, number[]>,
  input: { fromLevel: string; fromCell: number; toLevel: string; date: ISODate; option: FixationOption; incrementMonth: IncrementMonth },
): Fixation | null {
  const old = levels[input.fromLevel];
  const neu = levels[input.toLevel];
  if (!old || !neu || input.fromCell < 1 || input.fromCell > old.length) return null;
  const i = input.fromCell - 1;
  const basic = old[i];
  if (input.option === "FROM_PROMOTION") {
    const notional = stepUp(old, i);
    const cell = cellAtOrAbove(neu, notional);
    return {
      option: input.option,
      steps: [{ date: input.date, level: input.toLevel, cell, basic: neu[cell - 1], from: { level: input.fromLevel, cell: input.fromCell, basic, notional } }],
      incrementMonth: incrementMonthFor(input.date),
    };
  }
  const first = cellAtOrAbove(neu, basic);
  const dni = nextIncrementDate(input.date, input.incrementMonth);
  const twoUp = old[i + 2] ?? stepUp(old, i + 1 < old.length ? i + 1 : old.length - 1);
  const second = Math.max(first, cellAtOrAbove(neu, twoUp));
  return {
    option: input.option,
    steps: [
      { date: input.date, level: input.toLevel, cell: first, basic: neu[first - 1], from: { level: input.fromLevel, cell: input.fromCell, basic, notional: basic } },
      { date: dni, level: input.toLevel, cell: second, basic: neu[second - 1], from: { level: input.fromLevel, cell: input.fromCell, basic, notional: twoUp } },
    ],
    incrementMonth: input.incrementMonth,
  };
}
