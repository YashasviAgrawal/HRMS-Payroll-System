import "server-only";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { financialYear, todayIST, toISODate, type ISODate } from "@/lib/dates";
import { notFound } from "@/lib/errors";
import { fromPaise, toPaise } from "@/lib/money";
import { balancesFor, ensureCredits } from "@/modules/leave/balance";
import { canSeeLeaveOf } from "@/modules/leave/service";
import { titleOf } from "@/modules/payroll/compute";
import type { PayLine } from "@/modules/payroll/engine";
import { listLoans } from "@/modules/payroll/loans";
import { gpfAccount } from "@/modules/statutory/gpf";
import { canViewEmployee } from "./service";

/**
 * Client add-on: one employee on one screen — record, service, leave balances, last month's attendance, salary,
 * payslips, loans and GPF. Each block shows only to logins whose rights (PRD §14) cover it; the rest is left out.
 */
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;

/** Whole years and months between two dates (service so far, time to retirement). */
export function yearsAndMonths(from: ISODate, to: ISODate): { years: number; months: number } {
  if (to < from) return { years: 0, months: 0 };
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  if (months < 0) months = 0;
  return { years: Math.floor(months / 12), months: months % 12 };
}

export async function employeeOverview(actor: Actor, employeeId: string) {
  const e = await db.employee.findFirst({ where: { id: employeeId, boardId: actor.boardId }, include: { post: true, section: true } });
  if (!e || !canViewEmployee(actor, e)) throw notFound();
  const today = todayIST();
  const doj = toISODate(e.dateOfJoining);
  const dor = e.dateOfRetirement ? toISODate(e.dateOfRetirement) : null;
  const end = e.exitDate ? toISODate(e.exitDate) : today;
  const canLeave = canSeeLeaveOf(actor, e);
  const canPay = canAll(actor, "payroll", "view");
  const canLoans = canAll(actor, "arrears_loans", "view");
  const canGpf = canAll(actor, "statutory", "view") && e.type === "PERMANENT_OPS";

  if (canLeave) await ensureCredits(actor.boardId);
  const [balances, applications, attendance, slips, loans, gpf] = await Promise.all([
    canLeave ? balancesFor(e, actor.boardId) : null,
    canLeave ? db.leaveApplication.findMany({ where: { employeeId }, orderBy: { fromDate: "desc" }, take: 5 }) : null,
    db.attendanceMonth.findFirst({ where: { employeeId }, orderBy: { month: "desc" } }),
    canPay
      ? db.payslip.findMany({
          where: { employeeId, pensionerId: null, status: "INCLUDED", run: { status: { in: [...PAID] } } },
          include: { run: { select: { kind: true, seq: true, payGroup: true, month: true, source: true, status: true } } },
          orderBy: [{ month: "desc" }, { createdAt: "desc" }],
          take: 24,
        })
      : null,
    canLoans ? listLoans(actor, { employeeId }) : null,
    canGpf ? gpfAccount(actor, employeeId).catch(() => null) : null,
  ]);

  const regular = slips?.find((s) => s.run.kind === "REGULAR") ?? null;
  const fy = financialYear(today);
  const fySlips = (slips ?? []).filter((s) => financialYear(`${s.month}-01`) === fy);
  const sum = (pick: (s: NonNullable<typeof slips>[number]) => unknown) => fromPaise(fySlips.reduce((t, s) => t + toPaise(pick(s) as number), 0));

  return {
    facts: {
      service: yearsAndMonths(doj, end),
      toRetirement: dor && dor > today && ["ACTIVE", "SUSPENDED"].includes(e.status) ? yearsAndMonths(today, dor) : null,
    },
    leave: balances
      ? {
          balances: balances.filter((b) => b.balance !== null || b.pending > 0),
          applications: (applications ?? []).map((a) => ({ id: a.id, code: a.leaveCode, from: toISODate(a.fromDate), to: toISODate(a.toDate), days: num(a.days), status: a.status })),
        }
      : null,
    attendance: attendance
      ? { month: attendance.month, daysInMonth: attendance.daysInMonth, present: num(attendance.present), leave: num(attendance.leave), late: attendance.late, absentOrDiesNon: num(attendance.diesNon), payableDays: num(attendance.payableDays) }
      : null,
    pay: slips
      ? {
          last: regular
            ? { id: regular.id, month: regular.month, gross: num(regular.gross), deductions: num(regular.deductions), net: num(regular.net), lines: (regular.lines as unknown as PayLine[]).filter((l) => l.kind !== "EMPLOYER" && l.amount !== 0) }
            : null,
          year: { fy, gross: sum((s) => num(s.gross)), deductions: sum((s) => num(s.deductions)), net: sum((s) => num(s.net)), slips: fySlips.length },
          slips: slips.map((s) => ({ id: s.id, month: s.month, kind: s.run.kind, title: titleOf(s.run), titleHi: titleOf(s.run, "hi"), gross: num(s.gross), deductions: num(s.deductions), net: num(s.net), creditStatus: s.creditStatus })),
        }
      : null,
    loans: loans ? loans.filter((l) => l.status === "RUNNING" || l.status === "PENDING").map((l) => ({ id: l.id, type: l.type, purpose: l.purpose, principal: l.principal, instalmentAmount: l.instalmentAmount, left: fromPaise(toPaise(l.principalLeft) + toPaise(l.interestLeft)), status: l.status })) : null,
    gpf: gpf ? { balance: gpf.balance, advanceLeft: gpf.advances.reduce((t, a) => t + a.left, 0) } : null,
  };
}

export type EmployeeOverview = Awaited<ReturnType<typeof employeeOverview>>;

/** Each person's last approved regular salary (net, and the month) — for the Employees list, to logins that see pay. */
export async function lastNetPays(actor: Actor, employeeIds: string[]): Promise<Map<string, { month: string; net: number }>> {
  if (!canAll(actor, "payroll", "view") || !employeeIds.length) return new Map();
  const slips = await db.payslip.findMany({
    where: { boardId: actor.boardId, employeeId: { in: employeeIds }, pensionerId: null, status: "INCLUDED", run: { kind: "REGULAR", status: { in: [...PAID] } } },
    select: { employeeId: true, month: true, net: true },
    orderBy: [{ month: "desc" }],
    distinct: ["employeeId"],
  });
  return new Map(slips.map((s) => [s.employeeId, { month: s.month, net: num(s.net) }]));
}
