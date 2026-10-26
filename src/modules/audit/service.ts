import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { canSeeSensitive, scopeFor } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { fromISODate, addDays } from "@/lib/dates";
import { forbidden } from "@/lib/errors";

export interface AuditFilter {
  q?: string;
  action?: string;
  userId?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/**
 * S-71 audit trail. Approvers see everything. The User & settings manager sees system events only
 * (logins, users, settings) and never a pay, bank or Aadhaar value (PRD §14 note).
 */
export async function listAudit(actor: Actor, filter: AuditFilter = {}) {
  const scope = scopeFor(actor, "audit_trail", "view");
  if (!scope) throw forbidden();
  const systemOnly = scope === "system";
  const pageSize = Math.min(filter.pageSize ?? 50, 200);
  const page = Math.max(filter.page ?? 1, 1);
  const where: Prisma.AuditLogWhereInput = {
    boardId: actor.boardId,
    ...(systemOnly ? { category: "SYSTEM", isSensitive: false } : {}),
    ...(filter.action ? { action: filter.action } : {}),
    ...(filter.userId ? { userId: filter.userId } : {}),
    ...(filter.entityType ? { entityType: filter.entityType } : {}),
    ...(filter.entityId ? { entityId: filter.entityId } : {}),
    ...(filter.q ? { summary: { contains: filter.q, mode: "insensitive" } } : {}),
    ...(filter.from || filter.to
      ? {
          at: {
            ...(filter.from ? { gte: new Date(fromISODate(filter.from).getTime() - 5.5 * 3600_000) } : {}),
            ...(filter.to ? { lt: new Date(fromISODate(addDays(filter.to, 1)).getTime() - 5.5 * 3600_000) } : {}),
          },
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    db.auditLog.count({ where }),
  ]);
  const showSensitive = canSeeSensitive(actor);
  return {
    systemOnly,
    page,
    pageSize,
    total,
    rows: rows.map((r) => ({
      id: r.id.toString(),
      at: r.at.toISOString(),
      userName: r.userName,
      loginType: r.loginType,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      summary: r.summary,
      category: r.category,
      ip: r.ip,
      hidden: r.isSensitive && !showSensitive,
      oldValue: r.isSensitive && !showSensitive ? null : r.oldValue,
      newValue: r.isSensitive && !showSensitive ? null : r.newValue,
    })),
  };
}

export async function auditActions(actor: Actor) {
  const scope = scopeFor(actor, "audit_trail", "view");
  if (!scope) throw forbidden();
  const rows = await db.auditLog.findMany({
    where: { boardId: actor.boardId, ...(scope === "system" ? { category: "SYSTEM" } : {}) },
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
  });
  return rows.map((r) => r.action);
}
