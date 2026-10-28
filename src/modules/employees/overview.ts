import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { datesOfMonth, financialYear, fromISODate, todayIST, toISODate, type ISODate } from "@/lib/dates";
import { notFound } from "@/lib/errors";
import { fromPaise, toPaise } from "@/lib/money";
import { balancesFor, ensureCredits } from "@/modules/leave/balance";
import { canSeeLeaveOf } from "@/modules/leave/service";
import { titleOf } from "@/modules/payroll/compute";
import type { PayLine } from "@/modules/payroll/engine";
import { listLoans } from "@/modules/payroll/loans";
import { gpfAccount } from "@/modules/statutory/gpf";
import { fyOfMonth, monthsOfFy, type Period } from "./period";
import { canViewEmployee } from "./service";

/**
 * Client add-on: one employee on one screen — record, service, leave balances, attendance, salary, payslips, loans
 * and GPF — for the latest month, a chosen month, or a chosen financial year (month by month with the year's
 * totals). Each block shows only to logins whose rights (PRD §14) cover it; the rest is left out.
 */
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;
const sumPaise = (xs: number[]) => fromPaise(xs.reduce((t, x) => t + toPaise(x), 0));

/** Whole years and months between two dates (service so far, time to retirement). */
export function yearsAndMonths(from: ISODate, to: ISODate): { years: number; months: number } {
  if (to < from) return { years: 0, months: 0 };
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  if (months < 0) months = 0;
  return { years: Math.floor(months / 12), months: months % 12 };
}

type Slip = Prisma.PayslipGetPayload<{ include: { run: { select: { kind: true; seq: true; payGroup: true; month: true; source: true; status: true } } } }>;

const slipRow = (s: Slip) => ({ id: s.id, month: s.month, kind: s.run.kind, title: titleOf(s.run), titleHi: titleOf(s.run, "hi"), gross: num(s.gross), deductions: num(s.deductions), net: num(s.net), creditStatus: s.creditStatus });
const linesOf = (s: Slip) => (s.lines as unknown as PayLine[]).filter((l) => l.kind !== "EMPLOYER" && l.amount !== 0);
const lineTotal = (slips: Slip[], codes: string[]) => sumPaise(slips.flatMap((s) => linesOf(s).filter((l) => codes.includes(l.code)).map((l) => l.amount)));

export async function employeeOverview(actor: Actor, employeeId: string, period: Period | null = null) {
  const e = await db.employee.findFirst({ where: { id: employeeId, boardId: actor.boardId }, include: { post: true, section: true } });
  if (!e || !canViewEmployee(actor, e)) throw notFound();
  const today = todayIST();
  const thisMonth = today.slice(0, 7);
  const doj = toISODate(e.dateOfJoining);
  const dor = e.dateOfRetirement ? toISODate(e.dateOfRetirement) : null;
  const end = e.exitDate ? toISODate(e.exitDate) : today;
  const canLeave = canSeeLeaveOf(actor, e);
  const canPay = canAll(actor, "payroll", "view");
  const canLoans = canAll(actor, "arrears_loans", "view");
  const canGpf = canAll(actor, "statutory", "view") && e.type === "PERMANENT_OPS";

  const month = period?.view === "month" ? period.month : null;
  // The financial year whose totals are shown: the one chosen, the chosen month's, or this one.
  const fy = period?.view === "year" ? period.fy : month ? fyOfMonth(month) : financialYear(today);
  const fyMonths = monthsOfFy(fy, thisMonth);
  // Leave applications for the period: those touching the month, those starting in the year, or the latest five.
  const leaveWhere: Prisma.LeaveApplicationWhereInput =
    period?.view === "month"
      ? { employeeId, fromDate: { lte: fromISODate(datesOfMonth(period.month).at(-1)!) }, toDate: { gte: fromISODate(`${period.month}-01`) } }
      : period?.view === "year"
        ? { employeeId, fromDate: { gte: fromISODate(`${fy.slice(0, 4)}-04-01`), lte: fromISODate(`${Number(fy.slice(0, 4)) + 1}-03-31`) } }
        : { employeeId };
  const slipInclude = { run: { select: { kind: true, seq: true, payGroup: true, month: true, source: true, status: true } } } as const;
  const paidSlip = { employeeId, pensionerId: null, status: "INCLUDED" as const, run: { status: { in: [...PAID] } } };

  if (canLeave) await ensureCredits(actor.boardId);
  const [balances, applications, attendance, attendanceYear, fySlips, latestRegular, loans, gpf] = await Promise.all([
    canLeave ? balancesFor(e, actor.boardId) : null,
    canLeave ? db.leaveApplication.findMany({ where: leaveWhere, orderBy: { fromDate: "desc" }, take: period ? 100 : 5 }) : null,
    db.attendanceMonth.findFirst({ where: { employeeId, ...(month ? { month } : {}) }, orderBy: { month: "desc" } }),
    period?.view === "year" ? db.attendanceMonth.findMany({ where: { employeeId, month: { in: fyMonths } } }) : null,
    canPay ? db.payslip.findMany({ where: { ...paidSlip, month: { in: fyMonths } }, include: slipInclude, orderBy: [{ month: "desc" }, { createdAt: "desc" }] }) : null,
    canPay && !period ? db.payslip.findFirst({ where: { ...paidSlip, run: { status: { in: [...PAID] }, kind: "REGULAR" } }, include: slipInclude, orderBy: [{ month: "desc" }] }) : null,
    canLoans ? listLoans(actor, { employeeId }) : null,
    canGpf ? gpfAccount(actor, employeeId).catch(() => null) : null,
  ]);

  // The salary shown in detail: the chosen month's regular slip, else the latest one.
  const shown = month ? (fySlips?.find((s) => s.month === month && s.run.kind === "REGULAR") ?? null) : period ? null : latestRegular;
  const alsoPaid = month ? (fySlips ?? []).filter((s) => s.month === month && s.run.kind !== "REGULAR") : [];
  const attBy = new Map((attendanceYear ?? []).map((a) => [a.month, a]));
  const approved = (applications ?? []).filter((a) => a.status === "APPROVED");
  const taken = new Map<string, number>();
  for (const a of approved) taken.set(a.leaveCode, (taken.get(a.leaveCode) ?? 0) + num(a.days));
  const attView = (a: NonNullable<typeof attendance>) => ({ month: a.month, daysInMonth: a.daysInMonth, present: num(a.present), leave: num(a.leave), late: a.late, absentOrDiesNon: num(a.diesNon), payableDays: num(a.payableDays) });

  return {
    period,
    fy,
    facts: {
      service: yearsAndMonths(doj, end),
      toRetirement: dor && dor > today && ["ACTIVE", "SUSPENDED"].includes(e.status) ? yearsAndMonths(today, dor) : null,
    },
    leave: balances
      ? {
          balances: balances.filter((b) => b.balance !== null || b.pending > 0),
          applications: (applications ?? []).map((a) => ({ id: a.id, code: a.leaveCode, from: toISODate(a.fromDate), to: toISODate(a.toDate), days: num(a.days), status: a.status })),
          /** Approved leave in the chosen month or year, by leave code. */
          taken: period ? [...taken.entries()].map(([code, days]) => ({ code, days })).sort((x, y) => x.code.localeCompare(y.code)) : null,
        }
      : null,
    attendance: attendance && (!month || attendance.month === month) ? attView(attendance) : null,
    pay: fySlips
      ? {
          last: shown ? { id: shown.id, month: shown.month, gross: num(shown.gross), deductions: num(shown.deductions), net: num(shown.net), lines: linesOf(shown) } : null,
          alsoPaid: alsoPaid.map(slipRow),
          year: {
            fy,
            gross: sumPaise(fySlips.map((s) => num(s.gross))),
            deductions: sumPaise(fySlips.map((s) => num(s.deductions))),
            net: sumPaise(fySlips.map((s) => num(s.net))),
            slips: fySlips.length,
            tax: lineTotal(fySlips, ["IT"]),
            funds: lineTotal(fySlips, ["GPF", "NPS", "EPF"]),
            loans: lineTotal(fySlips, ["LOAN", "GPF_REFUND"]),
          },
          /** The chosen year month by month: what was paid (regular and supplementary bills) and the attendance. */
          months:
            period?.view === "year"
              ? fyMonths
                  .slice()
                  .reverse()
                  .map((m) => {
                    const ss = fySlips.filter((s) => s.month === m);
                    const a = attBy.get(m);
                    return {
                      month: m,
                      bills: ss.length,
                      gross: sumPaise(ss.map((s) => num(s.gross))),
                      deductions: sumPaise(ss.map((s) => num(s.deductions))),
                      net: sumPaise(ss.map((s) => num(s.net))),
                      attendance: a ? attView(a) : null,
                    };
                  })
              : null,
        }
      : null,
    loans: loans ? loans.filter((l) => l.status === "RUNNING" || l.status === "PENDING").map((l) => ({ id: l.id, type: l.type, purpose: l.purpose, principal: l.principal, instalmentAmount: l.instalmentAmount, left: fromPaise(toPaise(l.principalLeft) + toPaise(l.interestLeft)), status: l.status })) : null,
    gpf: gpf ? { balance: gpf.balance, advanceLeft: gpf.advances.reduce((t, a) => t + a.left, 0) } : null,
  };
}

export type EmployeeOverview = Awaited<ReturnType<typeof employeeOverview>>;

/** The person's paid salary slips — every one, or one financial year's with its totals (Payslips tab). */
export async function payslipsOf(actor: Actor, employeeId: string, fy: string | null) {
  const e = await db.employee.findFirst({ where: { id: employeeId, boardId: actor.boardId }, select: { id: true, sectionId: true } });
  if (!e || !canViewEmployee(actor, e)) throw notFound();
  if (!canAll(actor, "payroll", "view")) return null;
  const slips = await db.payslip.findMany({
    where: { employeeId, pensionerId: null, status: "INCLUDED", run: { status: { in: [...PAID] } }, ...(fy ? { month: { in: monthsOfFy(fy) } } : {}) },
    include: { run: { select: { kind: true, seq: true, payGroup: true, month: true, source: true, status: true } } },
    orderBy: [{ month: "desc" }, { createdAt: "desc" }],
    take: fy ? undefined : 120,
  });
  return slips.map(slipRow);
}

/** Leave applications of one calendar year, or the latest (Leave tab). */
export async function leaveApplicationsOf(actor: Actor, employeeId: string, year: number | null) {
  const e = await db.employee.findFirst({ where: { id: employeeId, boardId: actor.boardId }, select: { id: true, sectionId: true } });
  if (!e || !canViewEmployee(actor, e) || !canSeeLeaveOf(actor, e)) return null;
  const rows = await db.leaveApplication.findMany({
    where: { employeeId, ...(year ? { fromDate: { gte: fromISODate(`${year}-01-01`), lte: fromISODate(`${year}-12-31`) } } : {}) },
    orderBy: { fromDate: "desc" },
    take: year ? undefined : 20,
  });
  const taken = new Map<string, number>();
  for (const a of rows) if (a.status === "APPROVED") taken.set(a.leaveCode, (taken.get(a.leaveCode) ?? 0) + num(a.days));
  return {
    applications: rows.map((a) => ({ id: a.id, code: a.leaveCode, from: toISODate(a.fromDate), to: toISODate(a.toDate), days: num(a.days), status: a.status })),
    taken: [...taken.entries()].map(([code, days]) => ({ code, days })).sort((x, y) => x.code.localeCompare(y.code)),
  };
}

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
