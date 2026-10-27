import "server-only";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { addDays, fromISODate, isMonth, todayIST, toISODate } from "@/lib/dates";
import { forbidden } from "@/lib/errors";
import { titleOf } from "@/modules/payroll/compute";
import { applyRetirements } from "./events";
import { sendLifeCertificateReminders } from "./life-certificates";
import { canManagePension, canSeePension, lcViewOf } from "./pensioners";
import { lifeCertificateState } from "./rules";

/**
 * S-61 home: this month's pension bill (the same five stages as salaries), supplementary pension bills (benefits,
 * arrears), the bills before, and what needs doing — certificates to check, pensions held, retirements without a case.
 * Opening it also moves people whose retirement date has passed off the rolls and sends the day's certificate reminders.
 */
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

/** Once a day, on the first pension or home page opened: retirements (PN-10) and certificate reminders (PN-06). */
export function pensionDailyJobs(boardId: string) {
  void applyRetirements(boardId).catch((e) => console.error("[pension] retirements failed", e));
  void sendLifeCertificateReminders(boardId).catch((e) => console.error("[pension] reminders failed", e));
}

export async function pensionOverview(actor: Actor, monthParam?: string) {
  if (!canSeePension(actor)) throw forbidden();
  pensionDailyJobs(actor.boardId);
  const today = todayIST();
  const month = monthParam && isMonth(monthParam) && monthParam <= today.slice(0, 7) ? monthParam : today.slice(0, 7);
  const [runs, pensioners, waiting, retiring, openCases] = await Promise.all([
    db.payrollRun.findMany({ where: { boardId: actor.boardId, payGroup: "PENSION" }, orderBy: [{ month: "desc" }, { kind: "asc" }, { seq: "asc" }], take: 60 }),
    db.pensioner.findMany({ where: { boardId: actor.boardId, status: "ACTIVE" }, select: { id: true, startDate: true, basicPension: true, lifeCertificates: { select: { certifiedOn: true, status: true } } } }),
    db.lifeCertificate.count({ where: { boardId: actor.boardId, status: "SUBMITTED" } }),
    db.employee.findMany({
      where: { boardId: actor.boardId, type: { in: ["PERMANENT_OPS", "PERMANENT_NPS"] }, status: { in: ["ACTIVE", "SUSPENDED"] }, dateOfRetirement: { gte: fromISODate(today), lte: fromISODate(addDays(today, 183)) } },
      select: { id: true, pensionCases: { where: { status: { not: "REJECTED" } }, select: { id: true } } },
    }),
    db.pensionCase.count({ where: { boardId: actor.boardId, status: { in: ["DRAFT", "CHECKING", "APPROVING"] } } }),
  ]);
  const money = (r: (typeof runs)[number]) => ({ id: r.id, month: r.month, kind: r.kind, seq: r.seq, status: r.status, employees: r.employees, gross: num(r.gross), deductions: num(r.deductions), net: num(r.net), title: titleOf(r), titleHi: titleOf(r, "hi") });
  const regular = runs.find((r) => r.month === month && r.kind === "REGULAR") ?? null;
  const open = regular ? await db.payrollException.count({ where: { runId: regular.id, resolution: null } }) : 0;
  const withheld = regular ? await db.payslip.count({ where: { runId: regular.id, status: "WITHHELD" } }) : 0;
  const lc = pensioners.map((p) => lcViewOf(p, today));
  const lastPaid = runs.find((r) => r.kind === "REGULAR" && ["APPROVED", "PAID", "CLOSED"].includes(r.status));
  return {
    month,
    regular: regular ? { ...money(regular), openExceptions: open, withheld } : null,
    supplementary: runs.filter((r) => r.kind === "SUPPLEMENTARY" && r.month === month).map(money),
    history: runs.filter((r) => r.month !== month).map(money),
    stats: {
      pensioners: pensioners.length,
      monthlyNet: lastPaid ? num(lastPaid.net) : null,
      lastPaidMonth: lastPaid?.month ?? null,
      dueSoon: lc.filter((x) => x.state === "DUE_SOON").length,
      overdue: lc.filter((x) => x.state === "OVERDUE").length,
      held: lc.filter((x) => x.state === "HELD").length,
      waiting,
      retiringNoCase: retiring.filter((e) => !e.pensionCases.length).length,
      retiring: retiring.length,
      openCases,
    },
    can: { run: canManagePension(actor) },
  };
}

/** For the HR & Accounts home: pension work waiting. */
export async function pensionWork(actor: Actor) {
  if (!canManagePension(actor)) return null;
  pensionDailyJobs(actor.boardId);
  const today = todayIST();
  const [retiring, pensioners] = await Promise.all([
    db.employee.findMany({
      where: { boardId: actor.boardId, type: { in: ["PERMANENT_OPS", "PERMANENT_NPS"] }, status: { in: ["ACTIVE", "SUSPENDED"] }, dateOfRetirement: { gte: fromISODate(today), lte: fromISODate(addDays(today, 183)) }, pensionCases: { none: { status: { not: "REJECTED" } } } },
      select: { id: true, firstName: true, middleName: true, lastName: true, nameHi: true, dateOfRetirement: true },
      orderBy: { dateOfRetirement: "asc" },
    }),
    db.pensioner.findMany({ where: { boardId: actor.boardId, status: "ACTIVE" }, select: { startDate: true, lifeCertificates: { select: { certifiedOn: true, status: true } } } }),
  ]);
  const held = pensioners.filter((p) => lcViewOf(p, today).state === "HELD").length;
  return { retiring: retiring.map((e) => ({ id: e.id, name: [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" "), nameHi: e.nameHi, lastDay: toISODate(e.dateOfRetirement!) })), held, pensioners: pensioners.length };
}

/** PN-12: what a pensioner sees first — the last pension paid and the life certificate. */
export async function pensionerHome(actor: Actor) {
  if (!actor.pensionerId) return null;
  const p = await db.pensioner.findUniqueOrThrow({ where: { id: actor.pensionerId }, include: { lifeCertificates: { select: { certifiedOn: true, status: true, note: true, createdAt: true }, orderBy: { createdAt: "desc" } } } });
  const last = await db.payslip.findFirst({ where: { pensionerId: p.id, status: "INCLUDED", run: { payGroup: "PENSION", status: { in: ["PAID", "CLOSED"] } } }, orderBy: [{ month: "desc" }, { createdAt: "desc" }], select: { id: true, month: true, net: true } });
  const lc = lcViewOf(p);
  const returned = p.lifeCertificates[0]?.status === "REJECTED" ? p.lifeCertificates[0] : null;
  return { ppoNumber: p.ppoNumber, lastSlip: last ? { id: last.id, month: last.month, net: num(last.net) } : null, lc, state: lifeCertificateState(lc.validTill, todayIST()), returnedNote: returned?.note ?? null };
}
