import type { ISODate } from "@/lib/dates";
import { fromPaise, percentOf, toPaise } from "@/lib/money";

/**
 * Year-wise dearness allowance and transport allowance (with DA on TA), read from the dated rates table. Every DA
 * order (+2%, +4%…) raises DA on Basic and DA on TA together; the table shows what each order meant. Pure.
 */
export type TaBand = "HIGH" | "MID" | "LOW";
export const TA_BANDS: TaBand[] = ["HIGH", "MID", "LOW"];

export interface RateRow {
  key: string;
  value: number;
  effectiveFrom: ISODate;
  note: string | null;
}

export interface DaTaRow {
  from: ISODate;
  da: number;
  /** Change in DA points from the order before; null for the first row. */
  daStep: number | null;
  ta: Record<TaBand, number>;
  daOnTa: Record<TaBand, number>;
  taTotal: Record<TaBand, number>;
  /** What changed on this date. */
  changed: ("DA" | "TA")[];
  note: string | null;
  upcoming: boolean;
}

export interface DaTaYear {
  year: string;
  rows: DaTaRow[];
  /** DA in force when the year began (or at its first order) and after its last order. */
  daStart: number;
  daEnd: number;
}

const valueOn = (rows: RateRow[], key: string, on: ISODate) =>
  rows.filter((r) => r.key === key && r.effectiveFrom <= on).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];

export function daTaHistory(rates: RateRow[], today: ISODate): DaTaYear[] {
  const keys = ["DA_PERCENT", "TA_HIGH", "TA_MID", "TA_LOW"];
  const relevant = rates.filter((r) => keys.includes(r.key));
  const dates = [...new Set(relevant.map((r) => r.effectiveFrom))].sort();
  const rows: DaTaRow[] = [];
  let prev: DaTaRow | null = null;
  for (const from of dates) {
    const da = valueOn(relevant, "DA_PERCENT", from)?.value ?? 0;
    const ta = { HIGH: valueOn(relevant, "TA_HIGH", from)?.value ?? 0, MID: valueOn(relevant, "TA_MID", from)?.value ?? 0, LOW: valueOn(relevant, "TA_LOW", from)?.value ?? 0 };
    const daOnTa = { HIGH: 0, MID: 0, LOW: 0 };
    const taTotal = { HIGH: 0, MID: 0, LOW: 0 };
    for (const b of TA_BANDS) {
      daOnTa[b] = fromPaise(percentOf(toPaise(ta[b]), da));
      taTotal[b] = ta[b] + daOnTa[b];
    }
    const changed: DaTaRow["changed"] = [];
    if (!prev || prev.da !== da) changed.push("DA");
    if (!prev || TA_BANDS.some((b) => prev!.ta[b] !== ta[b])) changed.push("TA");
    if (!changed.length) continue;
    const notes = relevant.filter((r) => r.effectiveFrom === from && r.note).map((r) => r.note!);
    const row: DaTaRow = { from, da, daStep: prev ? Math.round((da - prev.da) * 100) / 100 : null, ta, daOnTa, taTotal, changed, note: notes[0] ?? null, upcoming: from > today };
    rows.push(row);
    prev = row;
  }
  const byYear = new Map<string, DaTaRow[]>();
  for (const r of rows) byYear.set(r.from.slice(0, 4), [...(byYear.get(r.from.slice(0, 4)) ?? []), r]);
  return [...byYear.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, list]) => {
      const before = rows.filter((r) => r.from < `${year}-01-01`).at(-1);
      return { year, rows: [...list].reverse(), daStart: before?.da ?? list[0].da, daEnd: list.at(-1)!.da };
    });
}
