import type { EmployeeType } from "@/generated/prisma/enums";
import type { Fn } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";

/**
 * S-70: the shape every standard report returns — columns (text, money, numbers, dates), rows and optional totals —
 * so one screen shows them all and one exporter writes them to Excel and PDF (PRD §11).
 */
export type ColKind = "text" | "money" | "number" | "date" | "month";

export interface Col {
  key: string;
  /** A shared column name from `reports.cols`… */
  t?: string;
  /** …or a name of its own (a pay head, a day of the month). */
  label?: string;
  labelHi?: string;
  kind?: ColKind;
  /** Summed in the totals row. */
  total?: boolean;
  /** The cell is a code shown through these texts (for example "employees.type" → "Permanent (NPS)"). */
  enumKey?: string;
}

export type Cell = string | number | null;
/** A row: cell values by column key; `<key>Hi` holds the Hindi form of a text cell when there is one. */
export type Row = Record<string, Cell> & { _href?: string | null; _tone?: "red" | "amber" | null };

export interface ReportFilters {
  month: string;
  sectionId: string | null;
  type: EmployeeType | null;
}

export interface ReportLink {
  label: string;
  labelHi: string;
  href: string;
}

export interface ReportResult {
  columns: Col[];
  rows: Row[];
  /** A line under the title (the period, the bill, what a figure means). */
  note?: { en: string; hi: string };
  links?: ReportLink[];
}

export type Area = "employees" | "attendance" | "payroll" | "statutory" | "pension" | "control";
export type FilterKey = "month" | "section" | "type";

export interface ReportDef {
  no: number;
  key: string;
  area: Area;
  /** The §14 function whose view right the report needs (on top of Reports). */
  fn: Fn;
  filters: FilterKey[];
  /** Month the filter opens on: this month, or the last month with an approved salary (or pension) bill. */
  defaultMonth?: "current" | "lastBill" | "lastPension";
  run(actor: Actor, f: ReportFilters & { scopeSectionId: string | null }): Promise<ReportResult>;
}

export const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
export const PAID = ["APPROVED", "PAID", "CLOSED"] as const;
