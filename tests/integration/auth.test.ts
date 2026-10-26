import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { changePassword, startLogin, verifyLogin } from "@/modules/auth/service";
import { actorFor, hasTestDb, makeBoard, makeEmployee, makeUser } from "../support/factory";

const meta = { ip: "10.0.0.1", userAgent: "vitest" };

describe.skipIf(!hasTestDb)("sign-in with OTP (S-01, PRD §2 rule 4)", () => {
  let boardId: string;
  beforeAll(async () => {
    boardId = (await makeBoard()).id;
  });

  async function hrUser(password = "Secret123") {
    const u = await makeUser(boardId, "HR_ACCOUNTS", ["HR"]);
    await db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(password) } });
    return u;
  }

  it("password + OTP opens a session and is recorded", async () => {
    const u = await hrUser();
    const challenge = await startLogin({ loginType: "HR_ACCOUNTS", method: "password", identifier: u.loginId, password: "Secret123" }, meta);
    expect(challenge.devOtp).toMatch(/^\d{6}$/);
    expect(challenge.sentTo).toBe(`******${u.mobile.slice(-4)}`);
    const session = await verifyLogin({ challengeId: challenge.challengeId, otp: challenge.devOtp! }, meta);
    expect(session.token.length).toBeGreaterThan(20);
    expect(await db.auditLog.count({ where: { userId: u.id, action: "LOGIN" } })).toBe(1);
    // The SMS log never contains the OTP itself.
    const sms = await db.messageLog.findFirstOrThrow({ where: { recipient: u.mobile }, orderBy: { createdAt: "desc" } });
    expect(sms.body).not.toContain(challenge.devOtp);
  });

  it("an OTP works once only", async () => {
    const u = await hrUser();
    const c = await startLogin({ loginType: "HR_ACCOUNTS", method: "password", identifier: u.mobile, password: "Secret123" }, meta);
    await verifyLogin({ challengeId: c.challengeId, otp: c.devOtp! }, meta);
    await expect(verifyLogin({ challengeId: c.challengeId, otp: c.devOtp! }, meta)).rejects.toMatchObject({ key: "errors.otpExpired" });
  });

  it("wrong OTPs count down and then lock the challenge", async () => {
    const u = await hrUser();
    const c = await startLogin({ loginType: "HR_ACCOUNTS", method: "password", identifier: u.loginId, password: "Secret123" }, meta);
    const wrong = c.devOtp === "000000" ? "111111" : "000000";
    await expect(verifyLogin({ challengeId: c.challengeId, otp: wrong }, meta)).rejects.toMatchObject({ key: "errors.otpWrong", vars: { left: 4 } });
    for (let i = 0; i < 3; i++) await verifyLogin({ challengeId: c.challengeId, otp: wrong }, meta).catch(() => undefined);
    await expect(verifyLogin({ challengeId: c.challengeId, otp: wrong }, meta)).rejects.toMatchObject({ key: "errors.otpTooMany" });
    await expect(verifyLogin({ challengeId: c.challengeId, otp: c.devOtp! }, meta)).rejects.toMatchObject({ key: "errors.otpTooMany" });
  });

  it("five wrong passwords lock the login for 15 minutes", async () => {
    const u = await hrUser();
    for (let i = 0; i < 5; i++) {
      await expect(startLogin({ loginType: "HR_ACCOUNTS", method: "password", identifier: u.loginId, password: "nope" }, meta)).rejects.toMatchObject({ key: "errors.badCredentials" });
    }
    await expect(startLogin({ loginType: "HR_ACCOUNTS", method: "password", identifier: u.loginId, password: "Secret123" }, meta)).rejects.toMatchObject({ key: "errors.locked" });
  });

  it("unknown IDs get the same answer as a wrong password", async () => {
    await expect(startLogin({ loginType: "HR_ACCOUNTS", method: "password", identifier: "NOBODY99", password: "Secret123" }, meta)).rejects.toMatchObject({ key: "errors.badCredentials" });
  });

  it("mobile + OTP only is for employees and pensioners", async () => {
    await expect(startLogin({ loginType: "ADMIN", method: "otp", identifier: "9811111111" }, meta)).rejects.toMatchObject({ key: "errors.otpOnlyEmployees" });
    const emp = await makeEmployee(boardId);
    const u = await makeUser(boardId, "EMPLOYEE", [], emp.id);
    const c = await startLogin({ loginType: "EMPLOYEE", method: "otp", identifier: u.mobile }, meta);
    await expect(verifyLogin({ challengeId: c.challengeId, otp: c.devOtp! }, meta)).resolves.toMatchObject({ mustChangePassword: false });
  });

  it("an unregistered mobile still gets an OTP screen but no SMS and no session", async () => {
    const before = await db.messageLog.count();
    const c = await startLogin({ loginType: "EMPLOYEE", method: "otp", identifier: "9899999999" }, meta);
    expect(c.devOtp).toBeUndefined();
    expect(c.sentTo).toBe("******9999");
    expect(await db.messageLog.count()).toBe(before);
    await expect(verifyLogin({ challengeId: c.challengeId, otp: "123456" }, meta)).rejects.toMatchObject({ key: "errors.otpWrong" });
  });

  it("access ends after the last working day (rule 6)", async () => {
    const emp = await makeEmployee(boardId);
    await db.employee.update({ where: { id: emp.id }, data: { status: "RESIGNED", exitDate: new Date("2024-01-31T00:00:00Z") } });
    const u = await makeUser(boardId, "EMPLOYEE", [], emp.id);
    const c = await startLogin({ loginType: "EMPLOYEE", method: "otp", identifier: u.mobile }, meta);
    await expect(verifyLogin({ challengeId: c.challengeId, otp: c.devOtp! }, meta)).rejects.toMatchObject({ key: "errors.accessEnded" });
  });

  it("changing the password needs the current one and signs out other devices", async () => {
    const u = await hrUser("Secret123");
    const c1 = await startLogin({ loginType: "HR_ACCOUNTS", method: "password", identifier: u.loginId, password: "Secret123" }, meta);
    await verifyLogin({ challengeId: c1.challengeId, otp: c1.devOtp! }, meta);
    const actor = await actorFor(u.id);
    await expect(changePassword(actor, { currentPassword: "wrong", newPassword: "NewSecret456" })).rejects.toMatchObject({ key: "errors.currentPasswordWrong" });
    await expect(changePassword(actor, { currentPassword: "Secret123", newPassword: "short" })).rejects.toMatchObject({ key: "errors.passwordWeak" });
    await changePassword(actor, { currentPassword: "Secret123", newPassword: "NewSecret456" });
    expect(await db.session.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
  });
});
