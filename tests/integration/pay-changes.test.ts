import { beforeAll, describe, expect, it } from "vitest";
import { decide } from "@/lib/approvals/engine";
import { seal } from "@/lib/crypto";
import { db } from "@/lib/db";
import { shiftMonth, todayIST } from "@/lib/dates";
import { computeArrears, makeSupplementaryBill, previewArrears, withheldCandidates } from "@/modules/payroll/arrears";
import { computeRun, recordLoanRecoveries, saveRun, undoLoanRecoveries } from "@/modules/payroll/compute";
import { previewFixation, submitFixation } from "@/modules/payroll/fixation";
import { incrementDueList, submitIncrements } from "@/modules/payroll/increments";
import { getLoan, sanctionLoan } from "@/modules/payroll/loans";
import { incrementDatesAround } from "@/modules/payroll/pay-rules";
import { myPayslips, payslipPdf, sendPayslipNotices } from "@/modules/payroll/payslips";
import { getRun, resolveException } from "@/modules/payroll/run";
import { seedPayrollRules } from "../../prisma/seed-payroll";
import { actorFor, hasTestDb, makeBoard, makePost, makeSection, makeUser } from "../support/factory";

type Actor = Awaited<ReturnType<typeof actorFor>>;
const pendingTask = (entityId: string) => db.approvalTask.findFirstOrThrow({ where: { entityId, status: "PENDING" }, orderBy: { createdAt: "desc" } });

describe.skipIf(!hasTestDb)("pay changes, arrears, loans and payslips (PR-06 to PR-09, SL-01 to SL-05)", () => {
  const today = todayIST();
  const thisMonth = today.slice(0, 7);
  const { last } = incrementDatesAround(today);
  const runMonth = last.slice(0, 7);
  let boardId: string;
  let sectionId: string;
  let postL6: string;
  let postL8: string;
  const ids = { a: "", b: "", c: "" };
  let hr: Actor;
  let payroll: Actor;
  let checker: Actor;
  let approver: Actor;
  let staffA: Actor;
  let staffB: Actor;
  let runId = "";

  async function employee(key: "a" | "b" | "c", opts: { level: string; cell: number; doj: string; postId: string; bank: string | null }) {
    const b = opts.bank ? seal("bank", opts.bank) : null;
    const e = await db.employee.create({
      data: {
        boardId,
        employeeCode: `PC${key.toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
        type: "PERMANENT_NPS",
        status: "ACTIVE",
        firstName: "Change",
        lastName: key.toUpperCase(),
        gender: "F",
        dateOfBirth: new Date("1988-02-02T00:00:00Z"),
        dateOfJoining: new Date(`${opts.doj}T00:00:00Z`),
        dateOfRetirement: new Date("2048-02-29T00:00:00Z"),
        sectionId,
        postId: opts.postId,
        payLevel: opts.level,
        payCell: opts.cell,
        mobile: key === "a" ? "9811100001" : null,
        bankAccountEnc: b?.enc ?? null,
        bankAccountHash: b?.hash ?? null,
        bankAccountLast4: b?.last4 ?? null,
        ifsc: b ? "SBIN0001234" : null,
      },
    });
    ids[key] = e.id;
  }

  beforeAll(async () => {
    boardId = (await makeBoard()).id;
    await seedPayrollRules(db, boardId);
    sectionId = (await makeSection(boardId)).id;
    postL6 = (await makePost(boardId, "6")).id;
    const postL7 = (await makePost(boardId, "7")).id;
    postL8 = (await makePost(boardId, "8")).id;
    // A's increment falls on the last increment date (1 Jan for 2 Jan–1 Jul joiners, else 1 Jul).
    const dojA = last.endsWith("-01-01") ? "2015-03-10" : "2015-09-10";
    await employee("a", { level: "6", cell: 3, doj: dojA, postId: postL6, bank: "40001112223334" });
    await employee("b", { level: "7", cell: 5, doj: "2012-05-05", postId: postL7, bank: "40001112225555" });
    await employee("c", { level: "6", cell: 2, doj: "2016-01-20", postId: postL6, bank: null });
    hr = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["HR"])).id);
    payroll = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["PAYROLL"])).id);
    checker = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["CHECKER"])).id);
    approver = await actorFor((await makeUser(boardId, "ADMIN", ["APPROVER"])).id);
    staffA = await actorFor((await makeUser(boardId, "EMPLOYEE", [], ids.a)).id);
    staffB = await actorFor((await makeUser(boardId, "EMPLOYEE", [], ids.b)).id);

    // The regular bill of the increment month, paid at the old pay; C (no bank) is withheld.
    const computed = await computeRun(db, boardId, "NPS", runMonth, { ignoreAttendance: true });
    runId = (await db.$transaction((tx) => saveRun(tx, payroll, "NPS", runMonth, computed))).id;
    const noBank = (await getRun(payroll, runId)).exceptions.find((x) => x.employeeId === ids.c && x.code === "NO_BANK")!;
    await resolveException(payroll, runId, noBank.id, { resolution: "WITHHELD", note: "Bank details awaited" });
    await db.payrollRun.update({ where: { id: runId }, data: { status: "PAID", approvedAt: new Date(), paidAt: new Date() } });
  });

  it("lists who is due an increment and gives it through a Checker, with a service book entry (PR-06)", async () => {
    const list = await incrementDueList(hr, last);
    const a = list.rows.find((r) => r.employeeId === ids.a)!;
    expect(a).toMatchObject({ status: "ELIGIBLE", level: "6", fromCell: 3, toCell: 4, fromBasic: 37600, toBasic: 38700 });
    expect(list.rows.some((r) => r.employeeId === ids.b)).toBe(false);
    await expect(submitIncrements(hr, { dueDate: last, employeeIds: [] })).rejects.toBeTruthy();
    const task = await submitIncrements(hr, { dueDate: last, employeeIds: [ids.a], orderNumber: "DCB/Inc/1" });
    expect((await incrementDueList(hr, last)).rows.find((r) => r.employeeId === ids.a)!.status).toBe("WAITING");
    await decide(checker, task.id, "APPROVE");
    const e = await db.employee.findUniqueOrThrow({ where: { id: ids.a } });
    expect(e.payCell).toBe(4);
    expect(await db.serviceBookEntry.count({ where: { employeeId: ids.a, event: "INCREMENT", status: "APPROVED" } })).toBe(1);
    expect((await incrementDueList(hr, last)).rows.find((r) => r.employeeId === ids.a)!.status).toBe("DONE");
  });

  it("works out the late increment as arrears, due vs drawn, and pays it in a supplementary bill (PR-08)", async () => {
    const [arrears] = await computeArrears(db, boardId, [ids.a], runMonth, runMonth);
    const basic = arrears.months[0].lines.find((l) => l.code === "BASIC")!;
    expect(basic).toMatchObject({ drawn: 37600, due: 38700, diff: 1100 });
    const da = arrears.months[0].lines.find((l) => l.code === "DA")!;
    expect(da.diff).toBe(660);
    // NPS 10% on the arrears of Basic + DA.
    expect(arrears.months[0].lines.find((l) => l.code === "NPS")!.diff).toBe(176);
    expect(arrears.months[0].lines.some((l) => l.code === "GIS")).toBe(false);
    const preview = await previewArrears(payroll, { payGroup: "NPS", fromMonth: runMonth, toMonth: runMonth, employeeIds: [ids.a] });
    expect(preview).toHaveLength(1);
    const bill = await makeSupplementaryBill(payroll, { type: "ARREARS", payGroup: "NPS", fromMonth: runMonth, toMonth: runMonth, reason: "Increment of 1 Jan given late", employeeIds: [ids.a] });
    expect(bill).toMatchObject({ kind: "SUPPLEMENTARY", seq: 1, status: "DRAFT" });
    const data = await getRun(payroll, bill.id);
    expect(data.title).toMatch(/^Supplementary bill 1/);
    expect(data.people).toHaveLength(1);
    expect(data.people[0].net).toBe(arrears.net);
    // Once that bill is paid, the same months show no arrears left.
    await db.payrollRun.update({ where: { id: bill.id }, data: { status: "PAID" } });
    expect(await computeArrears(db, boardId, [ids.a], runMonth, runMonth)).toEqual([]);
  });

  it("pays withheld pay once it is put right, only once (PR-10 → S-42)", async () => {
    const before = await withheldCandidates(payroll, "NPS");
    const slip = before.find((s) => s.employeeId === ids.c)!;
    expect(slip.hasBank).toBe(false);
    const b = seal("bank", "40001112227777");
    await db.employee.update({ where: { id: ids.c }, data: { bankAccountEnc: b.enc, bankAccountHash: b.hash, bankAccountLast4: b.last4, ifsc: "SBIN0001234" } });
    const bill = await makeSupplementaryBill(payroll, { type: "WITHHELD", payGroup: "NPS", payslipIds: [slip.id] });
    const data = await getRun(payroll, bill.id);
    expect(data.people[0]).toMatchObject({ employeeId: ids.c, net: slip.net });
    expect(data.exceptions).toHaveLength(0);
    expect((await withheldCandidates(payroll, "NPS")).some((s) => s.id === slip.id)).toBe(false);
  });

  it("fixes pay on promotion with the rule chosen; a later step waits for its date (PR-07)", async () => {
    const input = { employeeId: ids.b, kind: "PROMOTION", toPostId: postL8, toLevel: "8", effectiveFrom: today, option: "FROM_NEXT_INCREMENT", orderNumber: "DCB/Promo/7" };
    const preview = await previewFixation(hr, input);
    expect(preview.current).toMatchObject({ level: "7", cell: 5, basic: 50500 });
    expect(preview.fixation.steps.map((s) => [s.cell, s.basic])).toEqual([
      [3, 50500],
      [5, 53600],
    ]);
    await expect(previewFixation(hr, { ...input, toLevel: "6" })).rejects.toMatchObject({ fields: { toLevel: "payroll.fixation.lowerLevel" } });
    const task = await submitFixation(hr, input);
    await decide(checker, task.id, "APPROVE");
    // A promotion needs an Admin after the Checker (§14 service book).
    expect(await db.payHistory.count({ where: { employeeId: ids.b, reason: "PROMOTION" } })).toBe(0);
    const second = await db.approvalTask.findFirstOrThrow({ where: { kind: "pay.fixation", entityId: ids.b, status: "PENDING" } });
    expect(second.requiredPermission).toBe("APPROVER");
    await decide(approver, second.id, "APPROVE");
    const e = await db.employee.findUniqueOrThrow({ where: { id: ids.b } });
    expect([e.payLevel, e.payCell, e.postId]).toEqual(["8", 3, postL8]);
    const rows = await db.payHistory.findMany({ where: { employeeId: ids.b, reason: "PROMOTION" }, orderBy: { effectiveFrom: "asc" } });
    expect(rows.map((r) => [r.payCell, r.applied])).toEqual([
      [3, true],
      [5, false],
    ]);
    expect(await db.serviceBookEntry.count({ where: { employeeId: ids.b, event: "PROMOTION", status: "APPROVED" } })).toBe(1);
  });

  it("recovers a loan through the payroll, records it on approval and takes it back on reopen (PR-09)", async () => {
    const loan = await sanctionLoan(payroll, { employeeId: ids.a, type: "FESTIVAL", principal: 3000, interestRate: 0, instalments: 3, startMonth: thisMonth, sanctionDate: today, orderNumber: "DCB/Adv/9" });
    await expect(sanctionLoan(payroll, { employeeId: ids.a, type: "FESTIVAL", principal: 3000, interestRate: 0, instalments: 3, startMonth: shiftMonth(thisMonth, -1), sanctionDate: today, orderNumber: "DCB/Adv/9" })).rejects.toMatchObject({ fields: { startMonth: "payroll.loans.startPast" } });
    await decide(checker, (await pendingTask(loan.id)).id, "APPROVE");
    await decide(approver, (await pendingTask(loan.id)).id, "APPROVE");
    expect((await getLoan(payroll, loan.id)).loan.status).toBe("RUNNING");
    const computed = await computeRun(db, boardId, "NPS", thisMonth, { ignoreAttendance: true });
    const slip = computed.slips.find((s) => s.employeeId === ids.a)!;
    expect(slip.lines.find((l) => l.code === "LOAN")!.amount).toBe(1000);
    expect((slip.detail as { loans: { loanId: string }[] }).loans[0].loanId).toBe(loan.id);
    const run = await db.$transaction((tx) => saveRun(tx, payroll, "NPS", thisMonth, computed));
    await db.$transaction((tx) => recordLoanRecoveries(tx, run.id));
    expect((await getLoan(payroll, loan.id)).recoveries.map((r) => r.principal)).toEqual([1000]);
    await db.$transaction((tx) => undoLoanRecoveries(tx, run.id));
    expect((await getLoan(payroll, loan.id)).recoveries).toEqual([]);
    // Recovery stops at zero: the third instalment closes the loan.
    for (const [i, m] of [shiftMonth(thisMonth, -2), shiftMonth(thisMonth, -1), thisMonth].entries()) await db.loanRecovery.create({ data: { loanId: loan.id, runId: `fake-${i}`, month: m, principal: 1000, interest: 0 } });
    await db.$transaction((tx) => recordLoanRecoveries(tx, run.id));
    expect((await db.loan.findUniqueOrThrow({ where: { id: loan.id } })).status).toBe("CLOSED");
  });

  it("shows each person their own payslips once paid and sends the notices once (SL-01 to SL-04)", async () => {
    const mine = await myPayslips(staffA);
    expect(mine.map((s) => s.month)).toContain(runMonth);
    const slipId = mine.find((s) => s.month === runMonth && s.kind === "REGULAR")!.id;
    await expect(payslipPdf(staffB, slipId, "en")).rejects.toMatchObject({ status: 403 });
    const { pdf, fileName } = await payslipPdf(staffA, slipId, "hi");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(fileName).toMatch(/-hi\.pdf$/);
    const first = await sendPayslipNotices(boardId, runId);
    expect(first.sent).toBeGreaterThan(0);
    expect(await db.messageLog.count({ where: { boardId, template: "payslip", recipient: "9811100001" } })).toBe(1);
    expect((await sendPayslipNotices(boardId, runId)).sent).toBe(0);
  });
});
