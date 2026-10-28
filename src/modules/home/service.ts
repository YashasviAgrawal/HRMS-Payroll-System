import "server-only";
import { countInbox, listInbox } from "@/lib/approvals";
import { hasApprovalsInbox } from "@/lib/auth/menu";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { addDays, endOfMonth, formatDate, formatMonth, todayIST, fromISODate, toISODate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { locksDue, sectionScope, todayBoard } from "@/modules/attendance/service";
import { ensureCredits, ledgerBalances } from "@/modules/leave/balance";
import { can, canAll, scopeFor } from "@/lib/auth/access";
import { RUN_GROUPS } from "@/modules/payroll/compute";
import { calendarFor, dueSoon, sendDueReminders } from "@/modules/statutory/calendar-service";
import { currentFy } from "@/modules/statutory/tax";
import { pensionDailyJobs, pensionerHome, pensionWork } from "@/modules/pension/overview";
import { applyExits } from "@/modules/employees/separation";
import { lcViewOf } from "@/modules/pension/pensioners";
import { incrementMonthFor, nextIncrementDate, qualifies } from "@/modules/payroll/pay-rules";

const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;
const GROUP_SHORT: Record<string, [string, string]> = { OPS: ["OPS", "ओपीएस"], NPS: ["NPS", "एनपीएस"], CONTRACT: ["Contract", "संविदा"] };
const STAGE: Record<string, [string, string]> = {
  DRAFT: ["being prepared", "तैयार हो रहा"],
  CHECKING: ["with Checker", "जाँचकर्ता के पास"],
  APPROVING: ["with Admin", "एडमिन के पास"],
  APPROVED: ["approved", "स्वीकृत"],
  PAID: ["paid", "भुगतान"],
  CLOSED: ["closed", "बंद"],
};
const MATRIX_TYPES = ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION"];

/**
 * S-02 Home: "My work" list + dashboard tiles. Every screen opens from "My work" (PRD §13), so each
 * module adds its own items here as it is switched on.
 */
export interface WorkItem {
  key: string;
  title: string;
  titleHi?: string | null;
  count?: number;
  href: string;
  tone: "green" | "amber" | "red" | "gray" | "blue";
  meta?: string;
  at?: string;
}

export interface Tile {
  key: string;
  value: string | number;
  href?: string;
  tone?: "green" | "amber" | "red" | "gray" | "blue";
  icon: "users" | "sections" | "employees" | "history" | "inbox" | "probation" | "joining" | "attendance" | "lock" | "leave" | "payroll" | "statutory" | "pension" | "certificate" | "cost" | "retire" | "alert" | "request" | "increment" | "joiners" | "migration";
  /** A short line under the figure (the month it is for, what is behind it). */
  hint?: string;
  hintHi?: string;
}

export async function myWork(actor: Actor): Promise<WorkItem[]> {
  const items: WorkItem[] = [];
  if (hasApprovalsInbox(actor)) {
    const tasks = await listInbox(actor, { take: 6 });
    for (const task of tasks) {
      items.push({
        key: task.id,
        title: task.title,
        titleHi: task.titleHi,
        href: `/approvals/${task.id}`,
        tone: "amber",
        meta: task.makerName,
        at: task.createdAt.toISOString(),
      });
    }
  }
  // AT-05: last month's attendance must be locked by the lock day.
  const due = await locksDue(actor);
  if (due && due.open.length) {
    const many = due.open.length > 1 ? ` (${due.open.length})` : "";
    const isOfficer = actor.loginType === "EMPLOYEE";
    items.unshift({
      key: "attendance-lock",
      title: `${due.overdue ? `${formatMonth(due.month)} attendance lock is overdue (was due ${formatDate(due.due)})` : `Lock ${formatMonth(due.month)} attendance by ${formatDate(due.due)}`}${many}`,
      titleHi: `${due.overdue ? `${formatMonth(due.month, "hi")} की उपस्थिति का लॉक बाकी है (${formatDate(due.due, "hi")} तक करना था)` : `${formatMonth(due.month, "hi")} की उपस्थिति ${formatDate(due.due, "hi")} तक लॉक करें`}${many}`,
      href: isOfficer ? `/attendance/lock?section=${due.open[0].id}&month=${due.month}` : `/attendance?tab=lock&month=${due.month}`,
      tone: due.overdue ? "red" : "amber",
    });
  }
  // ST-08: filings due within 5 days (and any overdue) for the people who prepare them; the day's SMS reminders.
  void sendDueReminders(actor.boardId).catch((e) => console.error("[statutory] reminders failed", e));
  // PN-10, PN-06: people past their retirement date leave the rolls; life certificate reminders go out (once a day).
  pensionDailyJobs(actor.boardId);
  // Client add-on: people past their last day of service leave the rolls (once a day).
  void applyExits(actor.boardId).catch((e) => console.error("[employees] exits failed", e));
  // Client add-on: full and final settlements for Payroll to prepare (the last day passed, nothing sent yet).
  if (canAll(actor, "arrears_loans", "create")) {
    const open = await db.separation.count({ where: { boardId: actor.boardId, status: "APPROVED", kind: { not: "SUSPENSION" }, settlementStatus: { in: ["NONE", "APPROVED"] }, effectiveDate: { lt: fromISODate(todayIST()) } } });
    if (open) items.push({ key: "settlements", title: `Full and final settlements to finish: ${open}`, titleHi: `पूरे किए जाने वाले अंतिम निपटान: ${open}`, href: "/employees/exits", tone: "amber" });
  }
  for (const d of await dueSoon(actor)) {
    const late = d.state === "OVERDUE";
    items.push({
      key: `due-${d.code}-${d.dueOn}`,
      title: `${d.name} (${d.period}) — ${late ? `overdue since ${formatDate(d.dueOn)}` : `due ${formatDate(d.dueOn)}`}`,
      titleHi: `${d.nameHi} (${d.period}) — ${late ? `${formatDate(d.dueOn, "hi")} से बकाया` : `देय ${formatDate(d.dueOn, "hi")}`}`,
      href: d.href,
      tone: late ? "red" : "amber",
    });
  }
  // PN-07, PN-06: pension cases to start for people retiring within six months; pensions held for a certificate.
  const pension = await pensionWork(actor);
  if (pension) {
    for (const r of pension.retiring.slice(0, 5)) {
      items.push({
        key: `pension-case-${r.id}`,
        title: `Start the pension case of ${r.name} (retires ${formatDate(r.lastDay)})`,
        titleHi: `${r.nameHi ?? r.name} का पेंशन प्रकरण शुरू करें (सेवानिवृत्ति ${formatDate(r.lastDay, "hi")})`,
        href: `/pension/cases/new?employee=${r.id}`,
        tone: "amber",
      });
    }
    if (pension.held) items.push({ key: "pension-held", title: `Pensions held for want of a life certificate: ${pension.held}`, titleHi: `जीवन प्रमाण पत्र न मिलने से रुकी पेंशन: ${pension.held}`, href: "/pension/life-certificates?lc=HELD", tone: "red" });
  }
  // PN-06, PN-12: the pensioner's own life certificate.
  const mine = await pensionerHome(actor);
  if (mine) {
    if (mine.returnedNote) items.unshift({ key: "lc-returned", title: `Your life certificate was not accepted: ${mine.returnedNote}`, titleHi: `आपका जीवन प्रमाण पत्र स्वीकार नहीं हुआ: ${mine.returnedNote}`, href: "/my/life-certificate", tone: "red" });
    else if (mine.lc.waiting === 0 && mine.state !== "VALID") {
      const held = mine.state === "HELD";
      items.unshift({
        key: "lc-due",
        title: held ? "Your pension is on hold — please give your life certificate" : `Please give your life certificate by ${formatDate(mine.lc.validTill)}`,
        titleHi: held ? "आपकी पेंशन रुकी है — कृपया जीवन प्रमाण पत्र दें" : `कृपया ${formatDate(mine.lc.validTill, "hi")} तक जीवन प्रमाण पत्र दें`,
        href: "/my/life-certificate",
        tone: held || mine.state === "OVERDUE" ? "red" : "amber",
      });
    }
  }
  // ST-02, ST-03: the employee's own tax declaration — the regime at the start of the year, proofs before January.
  if (actor.loginType === "EMPLOYEE" && actor.employeeId && actor.isEmployee) {
    const fy = currentFy();
    const today = todayIST();
    const month = Number(today.slice(5, 7));
    const decl = await db.taxDeclaration.findUnique({ where: { employeeId_fy: { employeeId: actor.employeeId, fy } } });
    if (decl?.status === "RETURNED") {
      items.unshift({ key: "tax-returned", title: "Your tax declaration was sent back — please correct it", titleHi: "आपकी कर घोषणा वापस भेजी गई — कृपया सुधारें", href: "/my/tax", tone: "red" });
    } else if ((!decl || decl.status === "DRAFT") && month >= 4 && month <= 7) {
      items.push({ key: "tax-regime", title: `Choose your tax regime for ${fy}`, titleHi: `${fy} के लिए अपनी कर व्यवस्था चुनें`, href: "/my/tax", tone: "blue" });
    } else if (decl?.regime === "OLD" && decl.status !== "VERIFIED" && (month === 11 || month === 12)) {
      const due = `${fy.slice(0, 4)}-12-31`;
      items.push({ key: "tax-proofs", title: `Send your investment proofs by ${formatDate(due)}`, titleHi: `${formatDate(due, "hi")} तक अपने निवेश प्रमाण भेजें`, href: "/my/tax", tone: "amber" });
    }
  }
  return items;
}

export async function homeTiles(actor: Actor): Promise<Tile[]> {
  const tiles: Tile[] = [];
  if (hasApprovalsInbox(actor)) {
    tiles.push({ key: "approvalsWaiting", value: await countInbox(actor), href: "/approvals", tone: "amber", icon: "inbox" });
  }
  // §11 Admin: this month's salary and pension cost (the last approved month until this month's bills are approved).
  if (actor.loginType === "ADMIN" && canAll(actor, "payroll", "view")) {
    const runs = await db.payrollRun.findMany({ where: { boardId: actor.boardId, status: { in: [...PAID] } }, select: { month: true, payGroup: true, gross: true, employer: true, employees: true }, orderBy: { month: "desc" }, take: 60 });
    const lastOf = (pension: boolean) => runs.find((r) => (r.payGroup === "PENSION") === pension)?.month ?? null;
    for (const pension of [false, true]) {
      const month = lastOf(pension);
      const here = runs.filter((r) => r.month === month && (r.payGroup === "PENSION") === pension);
      const amount = here.reduce((a, r) => a + num(r.gross) + (pension ? 0 : num(r.employer)), 0);
      tiles.push({
        key: pension ? "pensionCost" : "salaryCost",
        value: month ? formatINR(Math.round(amount)) : "—",
        href: pension ? "/pension" : `/reports/salary-cost${month ? `?month=${month}` : ""}`,
        icon: "cost",
        tone: "green",
        hint: month ? formatMonth(month) : undefined,
        hintHi: month ? formatMonth(month, "hi") : undefined,
      });
    }
    const today = todayIST();
    const retiring = await db.employee.count({ where: { boardId: actor.boardId, status: { in: ["ACTIVE", "SUSPENDED"] }, type: { not: "REEMPLOYED" }, dateOfRetirement: { gte: fromISODate(today), lte: fromISODate(addDays(today, 183)) } } });
    tiles.push({ key: "retiring6", value: retiring, href: "/reports/retirements-probation", icon: "retire", tone: retiring ? "amber" : "gray" });
  }
  if (can(actor, "users_settings", "view")) {
    const [users, sections] = await Promise.all([
      db.user.count({ where: { boardId: actor.boardId, status: "ACTIVE" } }),
      db.section.count({ where: { boardId: actor.boardId, isActive: true } }),
    ]);
    tiles.push({ key: "usersCount", value: users, href: "/admin/users", icon: "users" });
    tiles.push({ key: "sectionsCount", value: sections, icon: "sections", tone: "blue" });
  }
  if (can(actor, "employee_master", "view") && actor.loginType !== "EMPLOYEE") {
    const employees = await db.employee.count({ where: { boardId: actor.boardId, status: { in: ["ACTIVE", "SUSPENDED"] } } });
    tiles.push({ key: "employeesCount", value: employees, href: can(actor, "employee_master", "view") ? "/employees" : can(actor, "reports", "view") ? "/reports/headcount" : undefined, icon: "employees", tone: "green" });
    if (actor.loginType === "HR_ACCOUNTS") {
      // §11 HR & Accounts: joiners and leavers this month.
      const month = todayIST().slice(0, 7);
      const start = fromISODate(`${month}-01`);
      const end = fromISODate(endOfMonth(`${month}-01`));
      const [joined, left] = await Promise.all([
        db.employee.count({ where: { boardId: actor.boardId, status: { not: "DRAFT" }, dateOfJoining: { gte: start, lte: end } } }),
        db.employee.count({ where: { boardId: actor.boardId, exitDate: { gte: start, lte: end } } }),
      ]);
      tiles.push({ key: "joinersLeavers", value: `${joined} / ${left}`, href: can(actor, "reports", "view") ? "/reports/employee-list" : undefined, icon: "joiners", tone: "blue", hint: `${joined} joined · ${left} left`, hintHi: `${joined} आए · ${left} गए` });
    }
  }
  if (can(actor, "recruitment", "view") && actor.loginType === "HR_ACCOUNTS") {
    const today = todayIST();
    const in30 = new Date(fromISODate(today).getTime() + 30 * 86_400_000);
    const [probation, joining] = await Promise.all([
      db.employee.count({ where: { boardId: actor.boardId, status: "ACTIVE", confirmationDate: null, probationEndDate: { not: null, lte: in30 } } }),
      db.joining.count({ where: { boardId: actor.boardId, status: { in: ["IN_PROGRESS", "SUBMITTED"] } } }),
    ]);
    tiles.push({ key: "probationDue", value: probation, href: "/recruitment?tab=probation", icon: "probation", tone: probation ? "amber" : "gray" });
    tiles.push({ key: "joiningsOpen", value: joining, href: "/recruitment?tab=joining", icon: "joining", tone: "blue" });
  }
  // PN-12: a pensioner sees the last pension paid and the life certificate.
  const mine = await pensionerHome(actor);
  if (mine) {
    tiles.push({ key: "lastPension", value: mine.lastSlip ? formatINR(mine.lastSlip.net) : "—", href: "/my/pension-slips", icon: "pension", tone: "green" });
    tiles.push({ key: "lifeCertificate", value: formatDate(mine.lc.validTill), href: "/my/life-certificate", icon: "certificate", tone: mine.state === "VALID" ? "green" : mine.state === "DUE_SOON" ? "amber" : "red" });
  }
  // PRD §15: employees see their leave balance; HR & Accounts see leave waiting.
  if (actor.loginType === "EMPLOYEE" && actor.employeeId && actor.isEmployee) {
    await ensureCredits(actor.boardId);
    const bal = await ledgerBalances(actor.employeeId);
    const parts = ["EL", "CL"].filter((c) => bal.has(c)).map((c) => `${c} ${fmtDays(bal.get(c)!)}`);
    // §11 Employee: last net pay, leave balance, next increment date, requests waiting.
    const [slip, me, history, waiting] = await Promise.all([
      db.payslip.findFirst({ where: { employeeId: actor.employeeId, pensionerId: null, status: "INCLUDED", run: { status: { in: [...PAID] }, payGroup: { not: "PENSION" } } }, orderBy: [{ month: "desc" }, { createdAt: "desc" }], select: { month: true, net: true } }),
      db.employee.findUnique({ where: { id: actor.employeeId }, select: { type: true, dateOfJoining: true, dateOfRetirement: true, incrementMonth: true } }),
      db.payHistory.findFirst({ where: { employeeId: actor.employeeId, reason: { in: ["INITIAL", "PROMOTION", "MACP"] }, effectiveFrom: { lte: fromISODate(todayIST()) } }, orderBy: { effectiveFrom: "desc" }, select: { effectiveFrom: true } }),
      db.approvalTask.groupBy({ by: ["kind"], where: { boardId: actor.boardId, makerId: actor.userId, status: "PENDING" }, _count: { _all: true } }),
    ]);
    tiles.push({ key: "lastNetPay", value: slip ? formatINR(num(slip.net)) : "—", href: "/my/payslips", icon: "payroll", tone: "green", hint: slip ? formatMonth(slip.month) : undefined, hintHi: slip ? formatMonth(slip.month, "hi") : undefined });
    if (parts.length) tiles.push({ key: "leaveBalance", value: parts.join(" · "), href: "/leave", icon: "leave", tone: "green" });
    if (me && MATRIX_TYPES.includes(me.type)) {
      const today = todayIST();
      const lastChange = toISODate(history?.effectiveFrom ?? me.dateOfJoining);
      const month = (me.incrementMonth ?? incrementMonthFor(lastChange)) as 1 | 7;
      let next = nextIncrementDate(today, month);
      if (!qualifies(lastChange, next)) next = nextIncrementDate(next, month);
      const retires = me.dateOfRetirement ? toISODate(me.dateOfRetirement) : null;
      tiles.push({ key: "nextIncrement", value: retires && retires < next ? "—" : formatDate(next), icon: "increment", tone: "blue" });
    }
    // Requests still waiting, by what they are about; the tile opens the screen of the biggest group.
    const groups: { area: string; href: string; en: string; hi: string; n: number }[] = [
      { area: "leave.", href: "/leave", en: "leave", hi: "अवकाश", n: 0 },
      { area: "attendance.", href: "/my/attendance", en: "attendance", hi: "उपस्थिति", n: 0 },
      { area: "employee.", href: "/my/requests", en: "record", hi: "रिकॉर्ड", n: 0 },
      { area: "tax.", href: "/my/tax", en: "tax", hi: "कर", n: 0 },
    ];
    let total = 0;
    for (const w of waiting) {
      total += w._count._all;
      const g = groups.find((x) => w.kind.startsWith(x.area));
      if (g) g.n += w._count._all;
    }
    const shown = groups.filter((g) => g.n > 0).sort((a, b) => b.n - a.n);
    tiles.push({
      key: "pendingRequests",
      value: total,
      href: shown[0]?.href ?? "/my/requests",
      icon: "request",
      tone: total ? "amber" : "gray",
      hint: shown.length ? shown.map((g) => `${g.n} ${g.en}`).join(" · ") : undefined,
      hintHi: shown.length ? shown.map((g) => `${g.n} ${g.hi}`).join(" · ") : undefined,
    });
  }
  if (scopeFor(actor, "leave", "view") === "all" && actor.loginType === "HR_ACCOUNTS") {
    const waiting = await db.leaveApplication.count({ where: { boardId: actor.boardId, status: "PENDING" } });
    tiles.push({ key: "leaveWaiting", value: waiting, href: "/leave/manage", icon: "leave", tone: waiting ? "amber" : "gray" });
  }
  if (sectionScope(actor) === "all") {
    const board = await todayBoard(actor);
    tiles.push({ key: "presentToday", value: `${board.total.present} / ${board.total.staff}`, href: "/attendance", icon: "attendance", tone: "green" });
    const due = await locksDue(actor);
    if (due) tiles.push({ key: "locksDue", value: due.open.length, href: `/attendance?tab=lock&month=${due.month}`, icon: "lock", tone: due.open.length ? (due.overdue ? "red" : "amber") : "gray" });
  }
  // S-40: how far this month's payroll has got, for the people who run, check or sign it.
  if (canAll(actor, "payroll", "view") && actor.loginType !== "EMPLOYEE") {
    const month = todayIST().slice(0, 7);
    const runs = await db.payrollRun.findMany({ where: { boardId: actor.boardId, month, kind: "REGULAR", payGroup: { in: [...RUN_GROUPS] } }, select: { status: true, payGroup: true } });
    const approved = runs.filter((r) => ["APPROVED", "PAID", "CLOSED"].includes(r.status)).length;
    // §11 Admin: the stage each pay group's bill has reached this month.
    const stageOf = (g: string) => runs.find((r) => r.payGroup === g)?.status ?? null;
    tiles.push({
      key: "payrollMonth",
      value: `${approved} / ${RUN_GROUPS.length}`,
      href: "/payroll",
      icon: "payroll",
      tone: approved === RUN_GROUPS.length ? "green" : "amber",
      hint: RUN_GROUPS.map((g) => `${GROUP_SHORT[g][0]}: ${stageOf(g) ? STAGE[stageOf(g)!][0] : "not run"}`).join(" · "),
      hintHi: RUN_GROUPS.map((g) => `${GROUP_SHORT[g][1]}: ${stageOf(g) ? STAGE[stageOf(g)!][1] : "नहीं चला"}`).join(" · "),
    });
    if (canAll(actor, "payroll", "create") || canAll(actor, "payroll", "check")) {
      // §11 HR & Accounts: exceptions still open on this month's bills that are not yet approved.
      const open = await db.payrollException.count({ where: { resolution: null, run: { boardId: actor.boardId, month, status: { in: ["DRAFT", "CHECKING"] } } } });
      tiles.push({ key: "payrollExceptions", value: open, href: "/payroll", icon: "alert", tone: open ? "red" : "gray" });
    }
  }
  // S-61: the month's pension bill and the pensioners, for the people who run, check or sign it.
  if (canAll(actor, "pension", "view") && actor.loginType !== "EMPLOYEE") {
    const month = todayIST().slice(0, 7);
    const [run, pensioners] = await Promise.all([
      db.payrollRun.findFirst({ where: { boardId: actor.boardId, month, payGroup: "PENSION", kind: "REGULAR" }, select: { status: true } }),
      db.pensioner.count({ where: { boardId: actor.boardId, status: "ACTIVE" } }),
    ]);
    const paid = run && ["APPROVED", "PAID", "CLOSED"].includes(run.status);
    tiles.push({ key: "pensionMonth", value: pensioners, href: "/pension", icon: "pension", tone: paid ? "green" : "amber" });
    if (canAll(actor, "pension", "create")) {
      // §11 HR & Accounts: life certificates overdue (and pensions already held for one).
      const today = todayIST();
      const list = await db.pensioner.findMany({ where: { boardId: actor.boardId, status: "ACTIVE" }, select: { startDate: true, lifeCertificates: { select: { certifiedOn: true, status: true } } } });
      const states = list.map((p) => lcViewOf(p, today).state);
      const overdue = states.filter((st) => st === "OVERDUE" || st === "HELD").length;
      const held = states.filter((st) => st === "HELD").length;
      tiles.push({ key: "lcOverdue", value: overdue, href: "/pension/life-certificates?lc=OVERDUE", icon: "certificate", tone: overdue ? "red" : "gray", hint: held ? `${held} held` : undefined, hintHi: held ? `${held} रुकी` : undefined });
    }
  }
  // ST-08: open filings due in the next 5 days.
  if (canAll(actor, "statutory", "create")) {
    const due = await dueSoon(actor);
    tiles.push({ key: "statutoryDue", value: due.length, href: "/statutory", icon: "statutory", tone: due.some((d) => d.state === "OVERDUE") ? "red" : due.length ? "amber" : "gray" });
  }
  // S-90 (set-up only): HR & Accounts menus are full (§13), so the console opens from here until the cut-over.
  if (actor.loginType === "HR_ACCOUNTS" && canAll(actor, "migration", "view") && !(await db.setting.findUnique({ where: { boardId_key: { boardId: actor.boardId, key: "migration.cutover" } } }))) {
    const [staff, locked] = await Promise.all([
      db.employee.count({ where: { boardId: actor.boardId, status: { in: ["ACTIVE", "SUSPENDED"] } } }),
      db.recordVerification.count({ where: { boardId: actor.boardId, lockedAt: { not: null }, employee: { status: { in: ["ACTIVE", "SUSPENDED"] } } } }),
    ]);
    tiles.push({ key: "migrationSetup", value: `${locked} / ${staff}`, href: "/migration", icon: "migration", tone: "blue", hint: "records verified (§15)", hintHi: "रिकॉर्ड सत्यापित (§15)" });
  }
  if (can(actor, "audit_trail", "view")) {
    const start = new Date(fromISODate(todayIST()).getTime() - 5.5 * 3600_000);
    const count = await db.auditLog.count({
      where: { boardId: actor.boardId, at: { gte: start }, ...(actor.permissions.includes("APPROVER") ? {} : { category: "SYSTEM" }) },
    });
    tiles.push({ key: "auditToday", value: count, href: "/admin/audit", icon: "history", tone: "gray" });
  }
  return tiles;
}

/**
 * §11 Admin dashboard, below the tiles: headcount by employee type, who retires in the next six months, and the
 * statutory filings coming due — the Board at a glance for the people who approve and sign.
 */
export async function adminPanel(actor: Actor) {
  if (actor.loginType !== "ADMIN" || !canAll(actor, "payroll", "view") || !canAll(actor, "employee_master", "view")) return null;
  const today = todayIST();
  const [types, retiring, due] = await Promise.all([
    db.employee.groupBy({ by: ["type"], where: { boardId: actor.boardId, status: { in: ["ACTIVE", "SUSPENDED"] } }, _count: { _all: true } }),
    db.employee.findMany({
      where: { boardId: actor.boardId, status: { in: ["ACTIVE", "SUSPENDED"] }, type: { not: "REEMPLOYED" }, dateOfRetirement: { gte: fromISODate(today), lte: fromISODate(addDays(today, 183)) } },
      select: { id: true, firstName: true, middleName: true, lastName: true, nameHi: true, dateOfRetirement: true, post: { select: { name: true, nameHi: true } } },
      orderBy: { dateOfRetirement: "asc" },
      take: 8,
    }),
    canAll(actor, "statutory", "view") ? calendarFor(actor.boardId, addDays(today, -60), addDays(today, 30), today) : Promise.resolve([]),
  ]);
  return {
    headcount: types.map((t) => ({ type: t.type, count: t._count._all })).sort((a, b) => b.count - a.count),
    retiring: retiring.map((e) => ({ id: e.id, name: [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" "), nameHi: e.nameHi, post: e.post.name, postHi: e.post.nameHi, date: toISODate(e.dateOfRetirement!) })),
    due: due.filter((d) => d.state === "OPEN" || d.state === "OVERDUE").sort((a, b) => a.dueOn.localeCompare(b.dueOn)).slice(0, 6),
  };
}
