import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { LoginType, Permission } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { can, permissionConflicts, PERMISSIONS_BY_LOGIN } from "@/lib/auth/access";
import { revokeAllSessions, type Actor } from "@/lib/auth/session";
import { sendSms } from "@/lib/connectors/sms";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { checkPassword } from "@/lib/password-policy";
import { hashPassword } from "@/lib/password";
import { maskMobile } from "@/lib/utils";
import { loginIdField, mobileField } from "@/lib/validators";

export const userCreateSchema = z.object({
  loginType: z.enum(LoginType),
  loginId: loginIdField,
  displayName: z.string().trim().min(2).max(100),
  displayNameHi: z.string().trim().max(100).optional().or(z.literal("")),
  mobile: mobileField,
  email: z.union([z.literal(""), z.string().trim().email("validation.email")]).optional(),
  employeeId: z.string().nullable().optional(),
  permissions: z.array(z.enum(Permission)).default([]),
  temporaryPassword: z.string().optional().or(z.literal("")),
});

export const userUpdateSchema = userCreateSchema.omit({ loginType: true, loginId: true, temporaryPassword: true });

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

function assertCanView(actor: Actor) {
  if (!can(actor, "users_settings", "view")) throw forbidden();
}
function assertCanEdit(actor: Actor) {
  if (!actor.permissions.includes("USER_SETTINGS_MANAGER")) throw forbidden("users.readOnly");
}

function validatePermissions(loginType: LoginType, perms: Permission[]) {
  const allowed = new Set(PERMISSIONS_BY_LOGIN[loginType]);
  const bad = perms.filter((p) => !allowed.has(p));
  if (bad.length) throw badRequest("errors.validation", { permissions: "validation.invalid" });
  if (permissionConflicts(perms)) throw badRequest("users.conflict", { permissions: "users.conflict" });
  return [...new Set(perms)];
}

const userSelect = {
  id: true,
  loginType: true,
  loginId: true,
  displayName: true,
  displayNameHi: true,
  mobile: true,
  email: true,
  permissions: true,
  status: true,
  language: true,
  lastLoginAt: true,
  createdAt: true,
  mustChangePassword: true,
  employee: {
    select: { id: true, employeeCode: true, firstName: true, lastName: true, section: { select: { id: true, name: true, nameHi: true } } },
  },
} satisfies Prisma.UserSelect;

export type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

export async function listUsers(
  actor: Actor,
  filter: { q?: string; loginType?: LoginType; status?: "ACTIVE" | "DISABLED"; page?: number; pageSize?: number } = {},
) {
  assertCanView(actor);
  const pageSize = Math.min(filter.pageSize ?? 25, 100);
  const page = Math.max(filter.page ?? 1, 1);
  const q = filter.q?.trim();
  const where: Prisma.UserWhereInput = {
    boardId: actor.boardId,
    ...(filter.loginType ? { loginType: filter.loginType } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(q
      ? {
          OR: [
            { displayName: { contains: q, mode: "insensitive" } },
            { loginId: { contains: q.toUpperCase() } },
            { mobile: { contains: q } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.user.findMany({ where, select: userSelect, orderBy: [{ loginType: "asc" }, { displayName: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
    db.user.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function getUser(actor: Actor, id: string) {
  assertCanView(actor);
  const user = await db.user.findFirst({ where: { id, boardId: actor.boardId }, select: userSelect });
  if (!user) throw notFound();
  return user;
}

async function checkEmployee(actor: Actor, employeeId: string | null | undefined) {
  if (!employeeId) return null;
  const employee = await db.employee.findFirst({ where: { id: employeeId, boardId: actor.boardId } });
  if (!employee) throw badRequest("errors.validation", { employeeId: "validation.invalid" });
  return employee;
}

async function uniqueOrConflict<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (e) {
    const err = e as { code?: string; meta?: { target?: string[] | string; driverAdapterError?: { cause?: { constraint?: { fields?: string[] } } } } };
    if (err.code === "P2002") {
      const fields = [
        ...(Array.isArray(err.meta?.target) ? err.meta.target : [String(err.meta?.target ?? "")]),
        ...(err.meta?.driverAdapterError?.cause?.constraint?.fields ?? []),
      ].join(",");
      if (fields.includes("mobile")) throw conflict("errors.duplicate", { field: "mobile number" }, { mobile: "errors.duplicate" });
      if (fields.includes("employeeId")) throw conflict("errors.duplicate", { field: "login" }, { employeeId: "errors.duplicate" });
      throw conflict("errors.duplicate", { field: "sign-in ID" }, { loginId: "errors.duplicate" });
    }
    throw e;
  }
}

export async function createUser(actor: Actor, input: UserCreateInput) {
  assertCanEdit(actor);
  const permissions = validatePermissions(input.loginType, input.permissions);
  const employee = await checkEmployee(actor, input.employeeId);
  if (input.loginType === "EMPLOYEE" && !employee) {
    throw badRequest("errors.validation", { employeeId: "validation.required" });
  }
  const temp = input.temporaryPassword?.trim();
  if (temp && checkPassword(temp).length) throw badRequest("errors.passwordWeak", { temporaryPassword: "errors.passwordWeak" });
  if (!temp && input.loginType !== "EMPLOYEE") {
    // Admin and HR & Accounts must sign in with password + OTP (PRD §2 rule 4).
    throw badRequest("errors.validation", { temporaryPassword: "validation.required" });
  }

  const created = await uniqueOrConflict(() =>
    db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          boardId: actor.boardId,
          loginType: input.loginType,
          loginId: input.loginId,
          displayName: input.displayName,
          displayNameHi: input.displayNameHi || null,
          mobile: input.mobile,
          email: input.email || null,
          employeeId: employee?.id ?? null,
          permissions,
          passwordHash: temp ? await hashPassword(temp) : null,
          mustChangePassword: Boolean(temp),
          createdById: actor.userId,
        },
        select: userSelect,
      });
      await audit(tx, actor, {
        action: "CREATE",
        entityType: "User",
        entityId: user.id,
        summary: `Created ${input.loginType} login ${input.loginId} for ${input.displayName}`,
        newValue: { loginType: input.loginType, loginId: input.loginId, mobile: maskMobile(input.mobile), permissions },
        category: "SYSTEM",
      });
      return user;
    }),
  );
  // Welcome SMS is a courtesy; a gateway problem must not undo the new login.
  void sendSms(actor.boardId, input.mobile, "welcome", { url: env().APP_URL }, "en");
  return created;
}

export async function updateUser(actor: Actor, id: string, input: UserUpdateInput) {
  assertCanEdit(actor);
  const before = await db.user.findFirst({ where: { id, boardId: actor.boardId } });
  if (!before) throw notFound();
  const permissions = validatePermissions(before.loginType, input.permissions);
  const samePermissions = [...permissions].sort().join() === [...before.permissions].sort().join();
  if (id === actor.userId && !samePermissions) {
    // Nobody changes their own permissions — another settings manager must (maker-checker spirit).
    throw forbidden("errors.ownEntry");
  }
  const employee = await checkEmployee(actor, input.employeeId);
  if (before.loginType === "EMPLOYEE" && !employee) throw badRequest("errors.validation", { employeeId: "validation.required" });

  return uniqueOrConflict(() =>
    db.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          displayName: input.displayName,
          displayNameHi: input.displayNameHi || null,
          mobile: input.mobile,
          email: input.email || null,
          employeeId: employee?.id ?? null,
          permissions,
        },
        select: userSelect,
      });
      await audit(tx, actor, {
        action: "UPDATE",
        entityType: "User",
        entityId: id,
        summary: `Updated login ${before.loginId}`,
        oldValue: { displayName: before.displayName, mobile: maskMobile(before.mobile), permissions: before.permissions, employeeId: before.employeeId },
        newValue: { displayName: input.displayName, mobile: maskMobile(input.mobile), permissions, employeeId: employee?.id ?? null },
        category: "SYSTEM",
      });
      return user;
    }),
  );
}

export async function setUserStatus(actor: Actor, id: string, status: "ACTIVE" | "DISABLED") {
  assertCanEdit(actor);
  if (id === actor.userId) throw forbidden("errors.ownEntry");
  const before = await db.user.findFirst({ where: { id, boardId: actor.boardId } });
  if (!before) throw notFound();
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { status, failedLoginCount: 0, lockedUntil: null } });
    await audit(tx, actor, {
      action: status === "ACTIVE" ? "ENABLE" : "DISABLE",
      entityType: "User",
      entityId: id,
      summary: `${status === "ACTIVE" ? "Enabled" : "Disabled"} login ${before.loginId}`,
      oldValue: { status: before.status },
      newValue: { status },
      category: "SYSTEM",
    });
  });
  if (status === "DISABLED") await revokeAllSessions(id);
}

export async function resetPassword(actor: Actor, id: string, temporaryPassword: string) {
  assertCanEdit(actor);
  if (id === actor.userId) throw forbidden("errors.ownEntry");
  if (checkPassword(temporaryPassword).length) throw badRequest("errors.passwordWeak", { temporaryPassword: "errors.passwordWeak" });
  const before = await db.user.findFirst({ where: { id, boardId: actor.boardId } });
  if (!before) throw notFound();
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
    });
    await audit(tx, actor, { action: "PASSWORD_RESET", entityType: "User", entityId: id, summary: `Reset password of ${before.loginId}`, category: "SYSTEM" });
  });
  await revokeAllSessions(id);
}

/** Small employee search used to link a login to an employee record. Shows no pay or identity data. */
export async function lookupEmployees(actor: Actor, q: string) {
  assertCanView(actor);
  const term = q.trim();
  if (term.length < 2) return [];
  const rows = await db.employee.findMany({
    where: {
      boardId: actor.boardId,
      status: { not: "DRAFT" },
      OR: [
        { employeeCode: { contains: term.toUpperCase() } },
        { firstName: { contains: term, mode: "insensitive" } },
        { lastName: { contains: term, mode: "insensitive" } },
      ],
    },
    select: { id: true, employeeCode: true, firstName: true, lastName: true, mobile: true, status: true, section: { select: { name: true, nameHi: true } }, post: { select: { name: true, nameHi: true } } },
    take: 10,
    orderBy: { employeeCode: "asc" },
  });
  return rows;
}
