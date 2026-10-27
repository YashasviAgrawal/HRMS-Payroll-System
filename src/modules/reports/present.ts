import { formatDate, formatMonth } from "@/lib/dates";
import { tDynamic, type TFunction } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/types";
import { formatINR, fromPaise, toPaise } from "@/lib/money";
import type { Col, ReportResult, Row } from "./types";

/** How a report's columns and cells read on screen, in Excel and in the PDF — one set of rules for all three. */

export function colLabel(col: Col, t: TFunction, locale: Locale) {
  if (col.t) return tDynamic(t, col.t);
  return locale === "hi" ? (col.labelHi ?? col.label ?? col.key) : (col.label ?? col.key);
}

export const isNumeric = (col: Col) => col.kind === "money" || col.kind === "number";

/** The text of a cell ("" when empty). */
export function cellText(col: Col, row: Row, t: TFunction, locale: Locale): string {
  const v = row[col.key];
  if (v === null || v === undefined || v === "") return "";
  if (col.enumKey) return tDynamic(t, `${col.enumKey}.${v}`);
  switch (col.kind) {
    case "money":
      return formatINR(Number(v));
    case "number":
      return Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 });
    case "date":
      return formatDate(String(v), locale);
    case "month":
      return formatMonth(String(v), locale);
    default: {
      const hi = row[`${col.key}Hi`];
      return locale === "hi" && hi ? String(hi) : String(v);
    }
  }
}

/** Sums of the columns marked `total` (money to the paisa). */
export function totalsOf(result: ReportResult): Row | null {
  const cols = result.columns.filter((c) => c.total);
  if (!cols.length || !result.rows.length) return null;
  const row: Row = {};
  for (const c of cols) {
    const paise = result.rows.reduce((a, r) => a + toPaise(Number(r[c.key] ?? 0)), 0);
    row[c.key] = c.kind === "money" ? fromPaise(paise) : Math.round(paise) / 100;
  }
  return row;
}
