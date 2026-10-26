import "server-only";
import { countInbox, listInbox } from "@/lib/approvals";
import { hasApprovalsInbox } from "@/lib/auth/menu";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDate, formatMonth, todayIST, fromISODate } from "@/lib/dates";
import { locksDue, sectionScope, todayBoard } from "@/modules/attendance/service";
import { ensureCredits, ledgerBalances } from "@/modules/leave/balance";
import { can, canAll, scopeFor } from "@/lib/auth/access";
import { RUN_GROUPS } from "@/modules/payroll/compute";
import { dueSoon, sendDueReminders } from "@/modules/statutory/calendar-service";
import { currentFy } from "@/modules/statutory/tax";

const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

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
  icon: "users" | "sections" | "employees" | "history" | "inbox" | "probation" | "joining" | "attendance" | "lock" | "leave" | "payroll" | "statutory";
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
  // ST-02, ST-03: the employee's own tax declaration — the regime at the start of the year, proofs before January.
  if (actor.loginType === "EMPLOYEE" && actor.employeeId) {
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
    tiles.push({ key: "employeesCount", value: employees, icon: "employees", tone: "green" });
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
  // PRD §15: employees see their leave balance; HR & Accounts see leave waiting.
  if (actor.loginType === "EMPLOYEE" && actor.employeeId) {
    await ensureCredits(actor.boardId);
    const bal = await ledgerBalances(actor.employeeId);
    const parts = ["EL", "CL"].filter((c) => bal.has(c)).map((c) => `${c} ${fmtDays(bal.get(c)!)}`);
    if (parts.length) tiles.push({ key: "leaveBalance", value: parts.join(" · "), href: "/leave", icon: "leave", tone: "green" });
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
    const runs = await db.payrollRun.findMany({ where: { boardId: actor.boardId, month, payGroup: { in: [...RUN_GROUPS] } }, select: { status: true } });
    const approved = runs.filter((r) => ["APPROVED", "PAID", "CLOSED"].includes(r.status)).length;
    tiles.push({ key: "payrollMonth", value: `${approved} / ${RUN_GROUPS.length}`, href: "/payroll", icon: "payroll", tone: approved === RUN_GROUPS.length ? "green" : "amber" });
  }
  // ST-08: open filings due in the next 5 days.
  if (canAll(actor, "statutory", "create")) {
    const due = await dueSoon(actor);
    tiles.push({ key: "statutoryDue", value: due.length, href: "/statutory", icon: "statutory", tone: due.some((d) => d.state === "OVERDUE") ? "red" : due.length ? "amber" : "gray" });
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
