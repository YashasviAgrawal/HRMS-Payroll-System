import { addDays, daysBetweenInclusive, endOfMonth, type ISODate } from "@/lib/dates";
import { fromPaise, roundPaiseToRupee, toPaise } from "@/lib/money";
import type { PayLine } from "./engine";

/**
 * PR-08 by days: a pay change that takes effect in the middle of a month (a promotion on the 15th, a DA order
 * dated the 10th) is paid for the days it was in force. Pure — shared by the arrears service and its tests.
 */
export interface MonthPart {
  from: ISODate;
  to: ISODate;
  days: number;
}

/** Splits a month at every change date that falls after its 1st. A change on the 1st leaves the month whole. */
export function monthParts(month: string, changeDates: ISODate[]): MonthPart[] {
  const first = `${month}-01` as ISODate;
  const last = endOfMonth(first);
  const cuts = [...new Set(changeDates.filter((d) => d > first && d <= last))].sort();
  const starts = [first, ...cuts];
  return starts.map((from, i) => {
    const to = i + 1 < starts.length ? addDays(starts[i + 1], -1) : last;
    return { from, to, days: daysBetweenInclusive(from, to) };
  });
}

/**
 * The month's pay when it is made of parts: each part's full-month pay for the days it covers, head by head,
 * each head rounded to the rupee (D-03). One part gives back its own lines unchanged.
 */
export function combineParts(parts: { lines: PayLine[]; days: number }[], daysInMonth: number): PayLine[] {
  if (parts.length === 1) return parts[0].lines;
  const byCode = new Map<string, PayLine & { paise: number }>();
  for (const p of parts) {
    for (const l of p.lines) {
      const share = (toPaise(l.amount) * p.days) / daysInMonth;
      const cur = byCode.get(l.code);
      if (cur) cur.paise += share;
      else byCode.set(l.code, { ...l, paise: share });
    }
  }
  return [...byCode.values()].map(({ paise, ...l }) => ({ ...l, amount: fromPaise(roundPaiseToRupee(paise)) }));
}
