import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { datesOfMonth, fromISODate, shiftMonth, toISODate } from "@/lib/dates";
import { fullName } from "@/modules/employees/present";
import type { PayLine } from "@/modules/payroll/engine";
import { PAID, num, type ReportFilters } from "./types";

/** First and last day of a report month. */
export function monthBounds(month: string) {
  const dates = datesOfMonth(month);
  return { from: dates[0], to: dates[dates.length - 1], start: fromISODate(dates[0]), end: fromISODate(dates[dates.length - 1]) };
}

/** The section a report may cover: its own for a reporting officer, otherwise the one picked (or all). */
export const sectionOf = (f: ReportFilters & { scopeSectionId: string | null }) => f.scopeSectionId ?? f.sectionId;

/** People on the rolls at some point of the month (joined by its end, not gone before its start). */
export function onRollsWhere(boardId: string, f: ReportFilters & { scopeSectionId: string | null }): Prisma.EmployeeWhereInput {
  const { start, end } = monthBounds(f.month);
  const section = sectionOf(f);
  return {
    boardId,
    status: { not: "DRAFT" },
    dateOfJoining: { lte: end },
    OR: [{ status: { in: ["ACTIVE", "SUSPENDED"] } }, { exitDate: { gte: start } }],
    ...(section ? { sectionId: section } : {}),
    ...(f.type ? { type: f.type } : {}),
  };
}

export const employeeSelect = {
  id: true,
  employeeCode: true,
  firstName: true,
  middleName: true,
  lastName: true,
  nameHi: true,
  type: true,
  status: true,
  sectionId: true,
  payLevel: true,
  payCell: true,
  dateOfJoining: true,
  dateOfRetirement: true,
  exitDate: true,
  probationEndDate: true,
  confirmationDate: true,
  mobile: true,
  panHash: true,
  aadhaarHash: true,
  bankAccountHash: true,
  ifsc: true,
  pran: true,
  uan: true,
  esicNumber: true,
  gpfNumber: true,
  post: { select: { name: true, nameHi: true, code: true } },
  section: { select: { name: true, nameHi: true } },
} as const;

export const nameOf = (e: { firstName: string; middleName: string | null; lastName: string | null }) => fullName(e);
export const d = (v: Date | null | undefined) => (v ? toISODate(v) : null);

/** Approved salary slips paid in a month (regular and supplementary bills; pay withheld is left out), with the person. */
export async function salarySlips(boardId: string, f: ReportFilters & { scopeSectionId: string | null }, month = f.month, extra: Prisma.PayslipWhereInput = {}) {
  const section = sectionOf(f);
  return db.payslip.findMany({
    where: {
      boardId,
      month,
      pensionerId: null,
      status: "INCLUDED",
      run: { status: { in: [...PAID] }, payGroup: { not: "PENSION" } },
      ...(section ? { sectionId: section } : {}),
      ...(f.type ? { employee: { type: f.type } } : {}),
      ...extra,
    },
    include: {
      run: { select: { id: true, kind: true, seq: true, payGroup: true, status: true, month: true, source: true } },
      employee: { select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, type: true, pran: true, uan: true, esicNumber: true, gpfNumber: true, post: { select: { name: true, nameHi: true } } } },
    },
    orderBy: [{ employee: { employeeCode: "asc" } }, { createdAt: "asc" }],
  });
}
export type SalarySlip = Awaited<ReturnType<typeof salarySlips>>[number];

export const linesOf = (s: { lines: unknown }) => s.lines as unknown as PayLine[];
export const lineAmount = (s: { lines: unknown }, code: string) => linesOf(s).filter((l) => l.code === code).reduce((a, l) => a + l.amount, 0);

/** The latest month with an approved salary bill (where payroll reports open), or pension bill. */
export async function lastBilledMonth(boardId: string, pension = false) {
  const r = await db.payrollRun.findFirst({ where: { boardId, status: { in: [...PAID] }, payGroup: pension ? "PENSION" : { not: "PENSION" } }, orderBy: { month: "desc" }, select: { month: true } });
  return r?.month ?? null;
}

export async function sectionNames(boardId: string) {
  return new Map((await db.section.findMany({ where: { boardId }, select: { id: true, name: true, nameHi: true } })).map((s) => [s.id, s]));
}

export const previous = (month: string) => shiftMonth(month, -1);
export { num };
