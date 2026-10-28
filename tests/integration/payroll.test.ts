import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { decide } from "@/lib/approvals/engine";
import { seal } from "@/lib/crypto";
import { db } from "@/lib/db";
import { datesOfMonth, shiftMonth, todayIST } from "@/lib/dates";
import { loadFile } from "@/lib/storage";
import { accountingSummary, buildRepayFile, buildSalaryBankFile, closeRun, importReturnFile } from "@/modules/payroll/pay";
import { proposePayItem, proposeRate } from "@/modules/payroll/rates";
import { approveRun, checkRun, getRun, reopenRun, resolveException, runPayroll, startSigning, submitRun, withdrawRun } from "@/modules/payroll/run";
import { seedPayrollRules } from "../../prisma/seed-payroll";
import { actorFor, hasTestDb, makeBoard, makePost, makeSection, makeUser } from "../support/factory";

type Actor = Awaited<ReturnType<typeof actorFor>>;
const meta = { ip: "127.0.0.1", userAgent: "vitest" };

describe.skipIf(!hasTestDb)("payroll (S-40, PR-01 to PR-14)", () => {
  const month = todayIST().slice(0, 7);
  const last = shiftMonth(month, -1);
  let boardId: string;
  let sectionId: string;
  const ids: Record<"a" | "b" | "c", string> = { a: "", b: "", c: "" };
  const codes: Record<"a" | "b" | "c", string> = { a: "", b: "", c: "" };
  let payroll: Actor;
  let payrollSelf: Actor;
  let checker: Actor;
  let signer: Actor;
  let approver: Actor;
  let runId = "";

  async function employee(key: "a" | "b" | "c", postId: string, bank: string | null) {
    const b = bank ? seal("bank", bank) : null;
    const code = `PAY${key.toUpperCase()}${Date.now().toString(36).toUpperCase()}`;
    const e = await db.employee.create({
      data: {
        boardId,
        employeeCode: code,
        type: "PERMANENT_OPS",
        status: "ACTIVE",
        firstName: "Pay",
        lastName: key.toUpperCase(),
        gender: "M",
        dateOfBirth: new Date("1985-05-05T00:00:00Z"),
        dateOfJoining: new Date("2012-01-01T00:00:00Z"),
        dateOfRetirement: new Date("2045-05-31T00:00:00Z"),
        sectionId,
        postId,
        payLevel: "6",
        payCell: 1,
        bankAccountEnc: b?.enc ?? null,
        bankAccountHash: b?.hash ?? null,
        bankAccountLast4: b?.last4 ?? null,
        ifsc: b ? "SBIN0001234" : null,
      },
    });
    ids[key] = e.id;
    codes[key] = code;
  }

  /** Exceptions about people from other test files (no bank, no level…) are withheld so the run can move on. */
  async function clearOthers() {
    const run = await getRun(payroll, runId);
    for (const x of run.exceptions.filter((x) => !x.resolution && (!x.employeeId || !Object.values(ids).includes(x.employeeId)))) {
      await resolveException(payroll, runId, x.id, { resolution: x.allowed.includes("WITHHELD") ? "WITHHELD" : x.allowed[0], note: "Not part of this test" });
    }
  }

  async function throughApproval() {
    await submitRun(payroll, runId, {});
    await checkRun(checker, runId, { decision: "APPROVE" });
    const otp = await startSigning(signer, runId, meta);
    await approveRun(signer, runId, { decision: "APPROVE", challengeId: otp.challengeId, otp: otp.devOtp });
  }

  beforeAll(async () => {
    boardId = (await makeBoard()).id;
    await seedPayrollRules(db, boardId);
    sectionId = (await makeSection(boardId)).id;
    const postId = (await makePost(boardId, "6")).id;
    await employee("a", postId, "30001112223334");
    await employee("b", postId, "30001112225555");
    await employee("c", postId, null);
    // Last month locked for the section; B had three days of dies-non.
    const dim = datesOfMonth(last).length;
    await db.attendanceLock.create({ data: { boardId, sectionId, month: last, lockedById: "test", lockedByName: "Test" } });
    for (const key of ["a", "b", "c"] as const) {
      const loss = key === "b" ? 3 : 0;
      await db.attendanceMonth.create({
        data: { boardId, employeeId: ids[key], sectionId, month: last, daysInMonth: dim, daysOnRoll: dim, present: dim - loss, late: 0, halfDays: 0, onDuty: 0, leave: 0, holidays: 0, weeklyOffs: 0, diesNon: loss, payableDays: dim - loss, workedDays: dim - loss },
      });
    }
    payroll = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["PAYROLL"])).id);
    payrollSelf = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["PAYROLL"], ids.c)).id);
    checker = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["CHECKER"])).id);
    signer = await actorFor((await makeUser(boardId, "ADMIN", ["APPROVER", "PAY_BILL_SIGNER"])).id);
    approver = await actorFor((await makeUser(boardId, "ADMIN", ["APPROVER"])).id);
  });

  it("works out pay from the matrix, the rates and last month's locked attendance (PR-01, PR-02, D-17)", async () => {
    const run = await runPayroll(payroll, { payGroup: "OPS", month });
    runId = run.id;
    const data = await getRun(payroll, runId);
    const a = data.people.find((p) => p.employeeId === ids.a)!;
    const amount = (code: string) => a.lines.find((l) => l.code === code)?.amount;
    // Level 6 cell 1, DA 60%, HRA 30%, TA 3,600 + DA on TA — the PRD's worked example, on OPS.
    expect([amount("BASIC"), amount("DA"), amount("HRA"), amount("TA"), amount("DA_TA")]).toEqual([35400, 21240, 10620, 3600, 2160]);
    expect(a.gross).toBe(73020);
    expect(amount("GPF")).toBe(2124);
    expect(amount("GIS")).toBe(30);
    expect(amount("PENSION_ER")).toBe(5664);
    expect(a.net).toBe(73020 - 2124 - 30);
    const b = data.people.find((p) => p.employeeId === ids.b)!;
    expect(b.lossDays).toBe(3);
    expect(b.gross).toBeLessThan(a.gross);
  });

  it("blocks the Checker until each exception is resolved; nobody resolves their own (PR-10, rule 2)", async () => {
    const data = await getRun(payroll, runId);
    const noBank = data.exceptions.find((x) => x.employeeId === ids.c && x.code === "NO_BANK")!;
    expect(noBank.severity).toBe("BLOCK");
    await expect(submitRun(payroll, runId, {})).rejects.toMatchObject({ key: "payroll.errors.openExceptions" });
    await expect(resolveException(payrollSelf, runId, noBank.id, { resolution: "WITHHELD", note: "My own pay" })).rejects.toMatchObject({ key: "errors.ownPay" });
    await expect(resolveException(payroll, runId, noBank.id, { resolution: "EXPLAINED", note: "Not allowed here" })).rejects.toMatchObject({ key: "payroll.errors.resolutionNotAllowed" });
    await resolveException(payroll, runId, noBank.id, { resolution: "WITHHELD", note: "Bank details awaited" });
    await clearOthers();
    const after = await getRun(payroll, runId);
    expect(after.people.find((p) => p.employeeId === ids.c)!.status).toBe("WITHHELD");
    expect(after.run.net).toBe(after.people.filter((p) => p.status === "INCLUDED").reduce((s, p) => s + p.net, 0));
  });

  it("keeps resolutions that still apply when the payroll is worked out again", async () => {
    const again = await runPayroll(payroll, { payGroup: "OPS", month });
    expect(again.version).toBe(2);
    const data = await getRun(payroll, runId);
    expect(data.exceptions.find((x) => x.employeeId === ids.c && x.code === "NO_BANK")!.resolution).toBe("WITHHELD");
    expect(data.open).toBe(0);
  });

  it("goes to a Checker, who can be bypassed by nobody; the maker can take it back (S-40 stage 3)", async () => {
    await submitRun(payroll, runId, { note: "Ready" });
    await expect(runPayroll(payroll, { payGroup: "OPS", month })).rejects.toMatchObject({ key: "payroll.errors.notDraft" });
    await withdrawRun(payroll, runId);
    expect((await getRun(payroll, runId)).run.status).toBe("DRAFT");
    await submitRun(payroll, runId, {});
    await checkRun(checker, runId, { decision: "RETURN", note: "Check B's dies-non" });
    const returned = await getRun(payroll, runId);
    expect(returned.run.status).toBe("DRAFT");
    expect(returned.lastReturn?.note).toBe("Check B's dies-non");
    await submitRun(payroll, runId, {});
    await checkRun(checker, runId, { decision: "APPROVE" });
    expect((await getRun(payroll, runId)).run.status).toBe("APPROVING");
  });

  it("is approved only with the signer's OTP for this run (S-40 stage 4)", async () => {
    const task = await db.approvalTask.findFirstOrThrow({ where: { entityId: runId, kind: "payroll.approve", status: "PENDING" } });
    // The generic inbox cannot approve it without the OTP.
    await expect(decide(signer, task.id, "APPROVE")).rejects.toMatchObject({ key: "payroll.errors.otpNeeded" });
    // An Admin without the pay bill signer permission cannot ask for the OTP.
    await expect(startSigning(approver, runId, meta)).rejects.toMatchObject({ status: 403 });
    const otp = await startSigning(signer, runId, meta);
    await expect(approveRun(signer, runId, { decision: "APPROVE", challengeId: otp.challengeId, otp: otp.devOtp === "000000" ? "111111" : "000000" })).rejects.toMatchObject({ code: "otp_wrong" });
    await approveRun(signer, runId, { decision: "APPROVE", challengeId: otp.challengeId, otp: otp.devOtp });
    const data = await getRun(payroll, runId);
    expect(data.run.status).toBe("APPROVED");
    expect(data.run.approvedByName).toBe(signer.name);
  });

  it("can be reopened by an Admin with a reason only until the bank file is released (PR-13)", async () => {
    await expect(reopenRun(payroll, runId, { note: "Payroll cannot reopen this" })).rejects.toMatchObject({ status: 403 });
    await reopenRun(approver, runId, { note: "Promotion order received late" });
    expect((await getRun(payroll, runId)).run.status).toBe("DRAFT");
    await throughApproval();
    // A bank file still waiting for release is withdrawn with the reopen.
    const file = await buildSalaryBankFile(payroll, runId);
    await reopenRun(approver, runId, { note: "Wrong arrear in the bill" });
    expect((await db.fileRecord.findUniqueOrThrow({ where: { id: file.id } })).status).toBe("REJECTED");
    await throughApproval();
    const released = await buildSalaryBankFile(payroll, runId);
    const fileTask = await db.approvalTask.findFirstOrThrow({ where: { entityId: released.id, status: "PENDING" } });
    await decide(approver, fileTask.id, "APPROVE");
    expect((await getRun(payroll, runId)).run.status).toBe("PAID");
    await expect(reopenRun(approver, runId, { note: "Too late to reopen now" })).rejects.toMatchObject({ key: "payroll.errors.cannotReopen" });
  });

  it("builds the bank file from the record's bank account, without the withheld pay (PR-12)", async () => {
    const data = await getRun(payroll, runId);
    const file = await db.fileRecord.findUniqueOrThrow({ where: { id: data.bankFile!.id } });
    expect(file.fileName).toMatch(/\.xlsx$/);
    // The bank's columns in an Excel sheet: the account stays text (no lost zeros), the amount is a number.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await loadFile(file.storageKey)) as unknown as ArrayBuffer);
    const rows = (wb.worksheets[0].getSheetValues() as unknown[][]).filter(Boolean).map((r) => r.slice(1));
    expect(rows[0]).toEqual(["Sl No", "Employee ID", "Beneficiary name", "Account number", "IFSC", "Amount", "Payment mode", "Narration"]);
    const a = data.people.find((p) => p.employeeId === ids.a)!;
    const rowA = rows.find((r) => r[3] === "30001112223334")!;
    expect(rowA[4]).toBe("SBIN0001234");
    expect(rowA[5]).toBe(a.net);
    expect(rows.flat()).not.toContain(codes.c);
  });

  it("reads the return file, re-pays failed credits and closes with a balanced accounting summary (PR-12, PR-14)", async () => {
    const data = await getRun(payroll, runId);
    const b = data.people.find((p) => p.employeeId === ids.b)!;
    await expect(importReturnFile(payroll, runId, Buffer.from(`Employee ID,Amount,Status,Reason\n${codes.b},1.00,FAILED,Closed\n`), "r.csv")).rejects.toMatchObject({ key: "payroll.errors.returnMismatch" });
    await expect(importReturnFile(payroll, runId, Buffer.from(`Name,Total\nX,1\n`), "r.csv")).rejects.toMatchObject({ key: "payroll.errors.returnFile" });
    const read = await importReturnFile(payroll, runId, Buffer.from(`Employee ID,Amount,Status,Reason\n${codes.b},${b.net.toFixed(2)},FAILED,Account closed\n`), "return.csv");
    expect(read.failed).toBe(1);
    await expect(closeRun(payroll, runId)).rejects.toMatchObject({ key: "payroll.errors.failedOpen" });
    const repay = await buildRepayFile(payroll, runId);
    const repayTask = await db.approvalTask.findFirstOrThrow({ where: { entityId: repay.id, status: "PENDING" } });
    await decide(approver, repayTask.id, "APPROVE");
    const after = await getRun(payroll, runId);
    expect(after.people.find((p) => p.employeeId === ids.b)!.creditStatus).toBe("REPAID");
    expect(after.people.find((p) => p.employeeId === ids.a)!.creditStatus).toBe("CREDITED");
    await closeRun(payroll, runId);
    expect((await getRun(payroll, runId)).run.status).toBe("CLOSED");
    const rows = await accountingSummary(db, runId);
    const debit = rows.reduce((s, r) => s + r.debit, 0);
    const credit = rows.reduce((s, r) => s + r.credit, 0);
    expect(Math.round(debit)).toBe(Math.round(credit));
    expect(rows.find((r) => r.code === "NET")!.credit).toBe(after.run.net);
  });

  it("rates and pay items change only through approval (PR-02, PR-04)", async () => {
    await expect(proposeRate(checker, { key: "DA_PERCENT", value: 64, effectiveFrom: `${month}-01`, note: "DA order" })).rejects.toMatchObject({ status: 403 });
    const task = await proposeRate(payroll, { key: "DA_PERCENT", value: 64, effectiveFrom: `${month}-01`, note: "DA order 9/2026" });
    await expect(proposeRate(payroll, { key: "DA_PERCENT", value: 65, effectiveFrom: `${month}-01`, note: "Another DA order" })).rejects.toMatchObject({ key: "payroll.errors.ratePending" });
    await decide(approver, task.id, "APPROVE");
    const rate = await db.payRate.findFirstOrThrow({ where: { boardId, key: "DA_PERCENT", value: 64 } });
    expect(rate.note).toBe("DA order 9/2026");
    await expect(proposePayItem(payrollSelf, { employeeId: ids.c, headCode: "LICENCE", amount: 600, fromMonth: month })).rejects.toMatchObject({ key: "errors.ownPay" });
    await expect(proposePayItem(payroll, { employeeId: ids.a, headCode: "DA", amount: 600, fromMonth: month })).rejects.toMatchObject({ key: "payroll.errors.notItemHead" });
    const item = await proposePayItem(payroll, { employeeId: ids.a, headCode: "LICENCE", amount: 600, fromMonth: month });
    expect(await db.employeePayItem.count({ where: { employeeId: ids.a } })).toBe(0);
    await decide(checker, item.id, "APPROVE");
    expect(await db.employeePayItem.count({ where: { employeeId: ids.a, headCode: "LICENCE" } })).toBe(1);
  });
});
