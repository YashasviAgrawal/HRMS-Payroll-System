import "server-only";
import { EmployeeType } from "@/generated/prisma/enums";
import { scopeFor } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isMonth, todayIST } from "@/lib/dates";
import { forbidden, notFound } from "@/lib/errors";
import { ATTENDANCE_REPORTS } from "./attendance";
import { lastBilledMonth } from "./common";
import { CONTROL_REPORTS } from "./control";
import { EMPLOYEE_REPORTS } from "./employees";
import { PAYROLL_REPORTS } from "./payroll";
import { PENSION_REPORTS } from "./pension";
import { STATUTORY_REPORTS } from "./statutory";
import type { Area, ReportDef, ReportFilters, ReportResult } from "./types";

/**
 * S-70: the 25 standard reports of PRD §11. A report is open to a login with the Reports right AND the view right of the
 * function it reads (§14) — so HR sees employee, attendance and leave reports but not pay, Payroll sees pay and statutory
 * reports, Pension the pension register. A reporting officer sees their own section only, whatever is picked.
 */
export const REPORTS: ReportDef[] = [...EMPLOYEE_REPORTS, ...ATTENDANCE_REPORTS, ...PAYROLL_REPORTS, ...STATUTORY_REPORTS, ...PENSION_REPORTS, ...CONTROL_REPORTS].sort((a, b) => a.no - b.no);
export const AREAS: Area[] = ["employees", "attendance", "payroll", "statutory", "pension", "control"];

/** "all", the section the login is limited to, or null when the report is closed to it. */
export function reportScope(actor: Actor, def: ReportDef): "all" | string | null {
  const scopes = [scopeFor(actor, "reports", "view"), scopeFor(actor, def.fn, "view")];
  if (scopes.some((s) => s !== "all" && s !== "section")) return null;
  if (scopes.every((s) => s === "all")) return "all";
  return actor.sectionId ?? null;
}

export function reportsFor(actor: Actor) {
  return REPORTS.filter((r) => reportScope(actor, r) !== null);
}

export function reportDef(key: string) {
  return REPORTS.find((r) => r.key === key) ?? null;
}

export interface RanReport {
  def: ReportDef;
  filters: ReportFilters;
  /** Set when the login sees one section only. */
  lockedSectionId: string | null;
  result: ReportResult;
}

/** Runs a report with the filters asked for (bad or missing ones fall back to the defaults). */
export async function runReport(actor: Actor, key: string, raw: { month?: string | null; section?: string | null; type?: string | null }): Promise<RanReport> {
  const def = reportDef(key);
  if (!def) throw notFound();
  const scope = reportScope(actor, def);
  if (!scope) throw forbidden();
  const lockedSectionId = scope === "all" ? null : scope;
  const month = raw.month && isMonth(raw.month) ? raw.month : def.defaultMonth && def.defaultMonth !== "current" ? ((await lastBilledMonth(actor.boardId, def.defaultMonth === "lastPension")) ?? todayIST().slice(0, 7)) : todayIST().slice(0, 7);
  let sectionId: string | null = null;
  if (def.filters.includes("section") && raw.section && !lockedSectionId) {
    const s = await db.section.findFirst({ where: { id: raw.section, boardId: actor.boardId }, select: { id: true } });
    sectionId = s?.id ?? null;
  }
  const type = def.filters.includes("type") && raw.type && (Object.values(EmployeeType) as string[]).includes(raw.type) ? (raw.type as EmployeeType) : null;
  const filters: ReportFilters = { month, sectionId: lockedSectionId ?? sectionId, type };
  const result = await def.run(actor, { ...filters, scopeSectionId: lockedSectionId });
  return { def, filters, lockedSectionId, result };
}
