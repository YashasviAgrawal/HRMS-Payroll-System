import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { LoginType, Permission } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { todayIST, toISODate } from "@/lib/dates";
import { secureCookies } from "@/lib/env";
import { getRequestMeta } from "@/lib/request-meta";
import type { Principal } from "./access";
import { accessState } from "./access-state";

export const SESSION_COOKIE = "dcb_session";
/** PRD §2 rule 7 / §16: sessions time out after 15 minutes idle. */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
/** Hard limit even for an active session — one working day. */
const ABSOLUTE_LIFETIME_MS = 12 * 60 * 60 * 1000;
/** lastSeenAt is written at most this often to keep the database quiet. */
const TOUCH_INTERVAL_MS = 30 * 1000;

/** Everything a service needs to know about who is acting. */
export interface Actor extends Principal {
  userId: string;
  sessionId: string;
  boardId: string;
  loginId: string;
  name: string;
  nameHi: string | null;
  loginType: LoginType;
  permissions: Permission[];
  employeeId: string | null;
  /** Section of the person's own employee record — the reporting officer's scope (PRD §2 rule 5). */
  sectionId: string | null;
  language: "en" | "hi";
  mustChangePassword: boolean;
  ip: string | null;
  userAgent: string | null;
}

export async function createSession(userId: string, meta: { ip: string | null; userAgent: string | null }) {
  const token = randomToken(32);
  const now = Date.now();
  const expiresAt = new Date(now + ABSOLUTE_LIFETIME_MS);
  await db.session.create({
    data: { id: sha256(token), userId, expiresAt, ip: meta.ip, userAgent: meta.userAgent },
  });
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * The signed-in person for this request, or null. Checks revocation, the 15-minute idle limit,
 * the absolute lifetime, the login's status and whether the person's access has ended.
 * Cached per request so layouts, pages and services share one lookup.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = sha256(token);
  const session = await db.session.findUnique({
    where: { id },
    include: {
      user: {
        include: {
          employee: { select: { id: true, sectionId: true, status: true, exitDate: true, dateOfRetirement: true } },
        },
      },
    },
  });
  if (!session || session.revokedAt) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() > IDLE_TIMEOUT_MS) {
    await db.session.update({ where: { id }, data: { revokedAt: new Date() } }).catch(() => undefined);
    return null;
  }

  const { user } = session;
  const employee = user.employee;
  const state = accessState(
    {
      userStatus: user.status,
      loginType: user.loginType,
      employee: employee
        ? {
            status: employee.status,
            exitDate: employee.exitDate ? toISODate(employee.exitDate) : null,
            dateOfRetirement: employee.dateOfRetirement ? toISODate(employee.dateOfRetirement) : null,
          }
        : null,
      pensionFrom: null,
    },
    todayIST(),
  );
  if (!state.allowed) return null;

  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({ where: { id }, data: { lastSeenAt: new Date(now) } });
  }

  const meta = await getRequestMeta();
  return {
    userId: user.id,
    sessionId: id,
    boardId: user.boardId,
    loginId: user.loginId,
    name: user.displayName,
    nameHi: user.displayNameHi,
    loginType: user.loginType,
    permissions: user.permissions,
    employeeId: employee?.id ?? null,
    sectionId: employee?.sectionId ?? null,
    isEmployee: state.isEmployee,
    isPensioner: state.isPensioner,
    language: user.language === "hi" ? "hi" : "en",
    mustChangePassword: user.mustChangePassword,
    ip: meta.ip,
    userAgent: meta.userAgent,
  };
});

/** For pages and layouts: the actor, or a redirect to the sign-in screen. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) {
    // A cookie that no longer works means the session ended (idle timeout, sign-out elsewhere).
    const hadSession = (await cookies()).has(SESSION_COOKIE);
    redirect(hadSession ? "/login?reason=timeout" : "/login");
  }
  return actor;
}

export async function revokeSession(sessionId: string) {
  await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}
