import "server-only";
import type { EmployeeStatus, LoginType, OtpPurpose, UserStatus } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { accessState } from "@/lib/auth/access-state";
import { createSession, revokeAllSessions, type Actor } from "@/lib/auth/session";
import { currentBoard } from "@/lib/board";
import { sendSms } from "@/lib/connectors/sms";
import { hashOtp, randomDigits, randomToken, safeEqualHex } from "@/lib/crypto";
import { db } from "@/lib/db";
import { todayIST, toISODate } from "@/lib/dates";
import { devHelpersEnabled } from "@/lib/env";
import { AppError, badRequest, conflict, forbidden, tooMany } from "@/lib/errors";
import { checkPassword } from "@/lib/password-policy";
import { hashPassword, verifyPassword } from "@/lib/password";
import type { RequestMeta } from "@/lib/request-meta";
import { maskMobile } from "@/lib/utils";
import { MOBILE_RE, normaliseMobile } from "@/lib/validators";

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_S = 30;
export const OTP_MAX_RESENDS = 3;
/** At most this many OTP requests per login in 10 minutes. */
const OTP_WINDOW_MS = 10 * 60 * 1000;
const OTP_WINDOW_LIMIT = 5;
const PASSWORD_MAX_FAILS = 5;
const LOCK_MINUTES = 15;

// A real hash so that "no such user" takes as long as "wrong password".
const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";

export interface StartLoginInput {
  loginType: LoginType;
  method: "password" | "otp";
  identifier: string;
  password?: string;
}

export interface OtpChallengeView {
  challengeId: string;
  sentTo: string;
  resendAfter: number;
  /** Only in development with the console SMS provider — never in production. */
  devOtp?: string;
}

function userAccess(user: {
  status: UserStatus;
  loginType: LoginType;
  employee: { status: EmployeeStatus; exitDate: Date | null; dateOfRetirement: Date | null } | null;
}) {
  return accessState(
    {
      userStatus: user.status,
      loginType: user.loginType,
      employee: user.employee
        ? {
            status: user.employee.status,
            exitDate: user.employee.exitDate ? toISODate(user.employee.exitDate) : null,
            dateOfRetirement: user.employee.dateOfRetirement ? toISODate(user.employee.dateOfRetirement) : null,
          }
        : null,
      pensionFrom: null,
    },
    todayIST(),
  );
}

async function findUser(boardId: string, loginType: LoginType, identifier: string) {
  const raw = identifier.trim();
  const mobile = normaliseMobile(raw);
  const where = MOBILE_RE.test(mobile) && /^[+\d\s-]+$/.test(raw)
    ? { boardId, loginType, mobile }
    : { boardId, loginType, loginId: raw.toUpperCase() };
  return db.user.findFirst({
    where,
    include: { employee: { select: { status: true, exitDate: true, dateOfRetirement: true } } },
  });
}

async function issueOtp(
  boardId: string,
  user: { id: string; mobile: string; language: string } | null,
  purpose: OtpPurpose,
  meta: RequestMeta,
  context?: Record<string, unknown>,
  smsVars: Record<string, string> = {},
  typedIdentifier = "",
): Promise<OtpChallengeView> {
  const id = randomToken(18);
  const code = randomDigits(6);
  if (user) {
    const recent = await db.otpChallenge.count({
      where: { userId: user.id, purpose, createdAt: { gt: new Date(Date.now() - OTP_WINDOW_MS) } },
    });
    if (recent >= OTP_WINDOW_LIMIT) throw tooMany("errors.otpLimit");
  }
  await db.otpChallenge.create({
    data: {
      id,
      userId: user?.id ?? null,
      purpose,
      // Unknown login: store an unguessable hash so every OTP is "wrong" — same reply, no account probing.
      codeHash: user ? hashOtp(id, code) : hashOtp(id, randomToken(16)),
      sentTo: user ? maskMobile(user.mobile) : "",
      context: context ? JSON.parse(JSON.stringify(context)) : undefined,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      ip: meta.ip,
    },
  });
  if (user) {
    const lang = user.language === "hi" ? "hi" : "en";
    const template = purpose === "APPROVE_SIGN" ? "approveOtp" : "otp";
    const sent = await sendSms(boardId, user.mobile, template, { otp: code, ...smsVars }, lang);
    if (!sent.ok) throw new AppError(502, "sms_failed", "errors.smsFailed");
  }
  return {
    challengeId: id,
    sentTo: user ? maskMobile(user.mobile) : maskMobile(normaliseMobile(typedIdentifier)),
    resendAfter: OTP_RESEND_COOLDOWN_S,
    devOtp: user && devHelpersEnabled() ? code : undefined,
  };
}

/** Step 1 of S-01: check the password (or just the mobile) and send an OTP. */
export async function startLogin(input: StartLoginInput, meta: RequestMeta): Promise<OtpChallengeView> {
  const board = await currentBoard();
  if (input.method === "otp" && input.loginType !== "EMPLOYEE") throw forbidden("errors.otpOnlyEmployees");
  const user = await findUser(board.id, input.loginType, input.identifier);

  if (input.method === "password") {
    if (!input.password) throw badRequest("errors.validation", { password: "validation.required" });
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new AppError(423, "locked", "errors.locked", { minutes });
    }
    const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      if (user) {
        const fails = user.failedLoginCount + 1;
        const lock = fails >= PASSWORD_MAX_FAILS;
        await db.user.update({
          where: { id: user.id },
          data: lock
            ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) }
            : { failedLoginCount: fails },
        });
        await audit(db, { boardId: board.id, userId: user.id, name: user.displayName, loginType: user.loginType, ...meta }, {
          action: lock ? "LOGIN_LOCKED" : "LOGIN_FAILED",
          entityType: "User",
          entityId: user.id,
          summary: lock ? `Login locked for ${LOCK_MINUTES} minutes after wrong passwords` : "Wrong password",
          category: "SYSTEM",
        });
      }
      throw new AppError(401, "bad_credentials", "errors.badCredentials");
    }
    if (user.failedLoginCount > 0) await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0 } });
    const state = userAccess(user);
    if (!state.allowed) throw forbidden(state.reason === "disabled" ? "errors.userDisabled" : "errors.accessEnded");
  }

  return issueOtp(board.id, user, "LOGIN", meta, { loginType: input.loginType }, {}, input.identifier);
}

/** Step 2 of S-01: check the OTP and open a session. */
export async function verifyLogin(input: { challengeId: string; otp: string }, meta: RequestMeta) {
  const board = await currentBoard();
  const challenge = await checkOtp(input.challengeId, input.otp, "LOGIN");
  const user = await db.user.findUnique({
    where: { id: challenge.userId! },
    include: { employee: { select: { status: true, exitDate: true, dateOfRetirement: true } } },
  });
  if (!user) throw new AppError(401, "otp_wrong", "errors.otpExpired");
  const state = userAccess(user);
  if (!state.allowed) throw forbidden(state.reason === "disabled" ? "errors.userDisabled" : "errors.accessEnded");

  const session = await createSession(user.id, meta);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lockedUntil: null } });
  await audit(db, { boardId: board.id, userId: user.id, name: user.displayName, loginType: user.loginType, ...meta }, {
    action: "LOGIN",
    entityType: "User",
    entityId: user.id,
    summary: "Signed in",
    category: "SYSTEM",
  });
  return { ...session, language: user.language, mustChangePassword: user.mustChangePassword };
}

/** Checks an OTP and marks it used. Wrong codes count against the challenge. */
export async function checkOtp(challengeId: string, otp: string, purpose: OtpPurpose, userId?: string) {
  const challenge = await db.otpChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge || challenge.purpose !== purpose || challenge.consumedAt || (userId && challenge.userId !== userId)) {
    throw new AppError(400, "otp_expired", "errors.otpExpired");
  }
  if (challenge.expiresAt < new Date()) throw new AppError(400, "otp_expired", "errors.otpExpired");
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) throw new AppError(429, "otp_too_many", "errors.otpTooMany");
  if (!challenge.userId || !safeEqualHex(challenge.codeHash, hashOtp(challengeId, otp))) {
    const attempts = challenge.attempts + 1;
    await db.otpChallenge.update({ where: { id: challengeId }, data: { attempts } });
    if (attempts >= OTP_MAX_ATTEMPTS) throw new AppError(429, "otp_too_many", "errors.otpTooMany");
    throw new AppError(400, "otp_wrong", "errors.otpWrong", { left: OTP_MAX_ATTEMPTS - attempts });
  }
  const consumed = await db.otpChallenge.updateMany({
    where: { id: challengeId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) throw new AppError(400, "otp_expired", "errors.otpExpired");
  return challenge;
}

export async function resendOtp(challengeId: string, meta: RequestMeta): Promise<OtpChallengeView> {
  const board = await currentBoard();
  const challenge = await db.otpChallenge.findUnique({ where: { id: challengeId }, include: { user: true } });
  if (!challenge || challenge.consumedAt) throw new AppError(400, "otp_expired", "errors.otpExpired");
  const waited = (Date.now() - challenge.lastSentAt.getTime()) / 1000;
  if (waited < OTP_RESEND_COOLDOWN_S) {
    throw tooMany("errors.otpResendWait", { seconds: Math.ceil(OTP_RESEND_COOLDOWN_S - waited) });
  }
  if (challenge.resendCount >= OTP_MAX_RESENDS) throw tooMany("errors.otpLimit");
  const code = randomDigits(6);
  await db.otpChallenge.update({
    where: { id: challengeId },
    data: {
      codeHash: challenge.user ? hashOtp(challengeId, code) : hashOtp(challengeId, randomToken(16)),
      attempts: 0,
      resendCount: { increment: 1 },
      lastSentAt: new Date(),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      ip: meta.ip,
    },
  });
  if (challenge.user) {
    const lang = challenge.user.language === "hi" ? "hi" : "en";
    const sent = await sendSms(board.id, challenge.user.mobile, challenge.purpose === "APPROVE_SIGN" ? "approveOtp" : "otp", { otp: code, what: "" }, lang);
    if (!sent.ok) throw new AppError(502, "sms_failed", "errors.smsFailed");
  }
  return {
    challengeId,
    sentTo: challenge.sentTo,
    resendAfter: OTP_RESEND_COOLDOWN_S,
    devOtp: challenge.user && devHelpersEnabled() ? code : undefined,
  };
}

export async function logout(actor: Actor) {
  await db.session.updateMany({ where: { id: actor.sessionId }, data: { revokedAt: new Date() } });
  await audit(db, actor, { action: "LOGOUT", entityType: "User", entityId: actor.userId, summary: "Signed out", category: "SYSTEM" });
}

/** S-03: change password. Signs out every other device. */
export async function changePassword(actor: Actor, input: { currentPassword?: string; newPassword: string }) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (checkPassword(input.newPassword).length) throw badRequest("errors.passwordWeak", { newPassword: "errors.passwordWeak" });
  // First-time set-up (mustChangePassword or OTP-only accounts) does not ask for the old password —
  // the person has just proved themselves with an OTP.
  const needsCurrent = Boolean(user.passwordHash) && !user.mustChangePassword;
  if (needsCurrent && !(await verifyPassword(input.currentPassword ?? "", user.passwordHash))) {
    throw badRequest("errors.currentPasswordWrong", { currentPassword: "errors.currentPasswordWrong" });
  }
  if (user.passwordHash && (await verifyPassword(input.newPassword, user.passwordHash))) {
    throw badRequest("errors.passwordReused", { newPassword: "errors.passwordReused" });
  }
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
  });
  await revokeAllSessions(user.id, actor.sessionId);
  await audit(db, actor, { action: "PASSWORD_CHANGED", entityType: "User", entityId: user.id, summary: "Changed own password", category: "SYSTEM" });
}

/** S-03: change mobile — an OTP goes to the new number to prove it belongs to the person. */
export async function startMobileChange(actor: Actor, newMobileRaw: string, meta: RequestMeta) {
  const newMobile = normaliseMobile(newMobileRaw);
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (user.mobile === newMobile) throw badRequest("errors.sameMobile", { mobile: "errors.sameMobile" });
  const taken = await db.user.findFirst({
    where: { boardId: actor.boardId, loginType: user.loginType, mobile: newMobile, NOT: { id: user.id } },
  });
  if (taken) throw conflict("errors.duplicate", { field: "mobile number" }, { mobile: "errors.duplicate" });
  return issueOtp(actor.boardId, { id: user.id, mobile: newMobile, language: user.language }, "CHANGE_MOBILE", meta, { newMobile });
}

export async function confirmMobileChange(actor: Actor, input: { challengeId: string; otp: string }) {
  const challenge = await checkOtp(input.challengeId, input.otp, "CHANGE_MOBILE", actor.userId);
  const newMobile = (challenge.context as { newMobile: string }).newMobile;
  const before = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
  await db.$transaction(async (tx) => {
    // Every login of the same person moves to the new number together.
    if (before.employeeId) {
      await tx.user.updateMany({ where: { employeeId: before.employeeId }, data: { mobile: newMobile } });
      await tx.employee.update({ where: { id: before.employeeId }, data: { mobile: newMobile } });
    } else {
      await tx.user.update({ where: { id: actor.userId }, data: { mobile: newMobile } });
    }
    await audit(tx, actor, {
      action: "UPDATE",
      entityType: "User",
      entityId: actor.userId,
      summary: "Changed own mobile number",
      oldValue: { mobile: maskMobile(before.mobile) },
      newValue: { mobile: maskMobile(newMobile) },
      category: "SYSTEM",
    });
  });
}

export async function setLanguage(actor: Actor | null, language: "en" | "hi") {
  if (!actor) return;
  await db.user.update({ where: { id: actor.userId }, data: { language } });
}
