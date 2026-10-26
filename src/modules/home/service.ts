import "server-only";
import { countInbox, listInbox } from "@/lib/approvals";
import { can } from "@/lib/auth/access";
import { hasApprovalsInbox } from "@/lib/auth/menu";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { todayIST, fromISODate } from "@/lib/dates";

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
  icon: "users" | "sections" | "employees" | "history" | "inbox";
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
  if (can(actor, "audit_trail", "view")) {
    const start = new Date(fromISODate(todayIST()).getTime() - 5.5 * 3600_000);
    const count = await db.auditLog.count({
      where: { boardId: actor.boardId, at: { gte: start }, ...(actor.permissions.includes("APPROVER") ? {} : { category: "SYSTEM" }) },
    });
    tiles.push({ key: "auditToday", value: count, href: "/admin/audit", icon: "history", tone: "gray" });
  }
  return tiles;
}
