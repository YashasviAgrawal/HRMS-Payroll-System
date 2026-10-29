import { beforeAll, describe, expect, it } from "vitest";
import type { PayGroup } from "@/generated/prisma/enums";
import { decide } from "@/lib/approvals/engine";
import { seal } from "@/lib/crypto";
import { db } from "@/lib/db";
import { addDays, todayIST } from "@/lib/dates";
import { employeeOverview, leaveApplicationsOf, payslipsOf } from "@/modules/employees/overview";
import { uploadDocument, uploadServiceBooks } from "@/modules/employees/records";
import { currentSeparation, getSeparation, proposeReinstatement, proposeSeparation } from "@/modules/employees/separation";
import { listEmployees } from "@/modules/employees/service";
import { withheldCandidates } from "@/modules/payroll/arrears";
import { loanPosition, loanTermsOf } from "@/modules/payroll/loan-rules";
import { approveRun, checkRun, getRun, reopenRun, startSigning, submitRun } from "@/modules/payroll/run";
import { duesOnRecord, makeSettlementBill, recordReceipt, saveSettlementInputs, settlementView, submitSettlement } from "@/modules/payroll/settlement";
import { seedLeaveTypes } from "../../prisma/seed-leave";
import { seedPayrollRules } from "../../prisma/seed-payroll";
import { actorFor, hasTestDb, makePost, makeSection, makeUser } from "../support/factory";

type Actor = Awaited<ReturnType<typeof actorFor>>;
const meta = { ip: "127.0.0.1", userAgent: "vitest" };
let n = 0;
const uid = () => `${Date.now().toString(36)}${(n++).toString(36)}`.toUpperCase();

/**
 * Client add-ons on a Board of their own (so no other test file's payroll ever meets these people): suspension and
 * leaving service through a Checker and an Admin, the full and final settlement with every loan and recovery, paid by
 * a settlement bill or paid back by the person, the one-screen employee view, scanned service books and document types.
 */
describe.skipIf(!hasTestDb)("client add-ons — leaving service and the full and final settlement", () => {
  let boardId: string;
  let sectionId: string;
  let postId: string;
  let hr: Actor;
  let payroll: Actor;
  let checker: Actor;
  let approver: Actor;
  let signer: Actor;
  const runs: Record<string, string> = {};

  async function person(opts: { bank?: boolean; code?: string } = {}) {
    const b = opts.bank === false ? null : seal("bank", `3000${Math.floor(Math.random() * 1e10)}`.slice(0, 14));
    return db.employee.create({
      data: {
        boardId,
        employeeCode: opts.code ?? `CA${uid()}`,
        type: "PERMANENT_OPS",
        status: "ACTIVE",
        firstName: "Exit",
        lastName: uid(),
        gender: "F",
        dateOfBirth: new Date("1980-02-02T00:00:00Z"),
        dateOfJoining: new Date("2008-01-01T00:00:00Z"),
        dateOfRetirement: new Date("2040-02-29T00:00:00Z"),
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
  }

  /** Every step waiting on this record: Checkers take the Checker steps, the Admin the rest. */
  async function approveAll(entityId: string) {
    for (let i = 0; i < 4; i++) {
      const task = await db.approvalTask.findFirst({ where: { boardId, entityId, status: "PENDING" } });
      if (!task) return;
      await decide(task.requiredPermission === "CHECKER" ? checker : approver, task.id, "APPROVE");
    }
  }

  /** An approved regular OPS bill of an old month, to hang slips on (the month of leaving is paid before the settlement). */
  async function regularRun(month: string) {
    runs[month] ??= (await db.payrollRun.create({ data: { boardId, payGroup: "OPS", month, status: "APPROVED", runById: "test", runByName: "Test", runAt: new Date(), approvedAt: new Date() } })).id;
    return runs[month];
  }

  const LINES = [
    { code: "BASIC", name: "Basic pay", nameHi: "मूल वेतन", kind: "EARNING", amount: 35400, accountHead: "E-1.01" },
    { code: "DA", name: "Dearness allowance", nameHi: "महँगाई भत्ता", kind: "EARNING", amount: 4248, accountHead: "E-1.02" },
    { code: "GPF", name: "GPF subscription", nameHi: "जीपीएफ अंशदान", kind: "DEDUCTION", amount: 3000, accountHead: "D-2.02" },
    { code: "LOAN", name: "Loan and advance recovery", nameHi: "ऋण एवं अग्रिम वसूली", kind: "DEDUCTION", amount: 1000, accountHead: "D-2.07" },
  ];

  async function slip(employeeId: string, month: string, opts: { days: number; dim: number; net?: number; withheld?: string; lines?: typeof LINES }) {
    const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
    const lines = opts.lines ?? LINES;
    const gross = lines.filter((l) => l.kind === "EARNING").reduce((s, l) => s + l.amount, 0);
    const deductions = lines.filter((l) => l.kind === "DEDUCTION").reduce((s, l) => s + l.amount, 0);
    return db.payslip.create({
      data: {
        boardId,
        runId: await regularRun(month),
        employeeId,
        month,
        payGroup: "OPS" as PayGroup,
        sectionId: e.sectionId,
        postId: e.postId,
        daysInMonth: opts.dim,
        daysOnRoll: opts.days,
        lines,
        gross,
        deductions,
        net: opts.net ?? gross - deductions,
        employer: 0,
        status: opts.withheld ? "WITHHELD" : "INCLUDED",
        withheldReason: opts.withheld ?? null,
        detail: opts.withheld ? { loans: [] } : undefined,
      },
    });
  }

  async function loan(employeeId: string, opts: { principal: number; instalment: number; rate?: number; start: string; paid: string[] }) {
    return db.loan.create({
      data: {
        boardId,
        employeeId,
        type: "VEHICLE",
        purpose: "Scooter",
        principal: opts.principal,
        interestRate: opts.rate ?? 0,
        instalments: Math.ceil(opts.principal / opts.instalment),
        instalmentAmount: opts.instalment,
        sanctionDate: new Date(`${opts.start}-01T00:00:00Z`),
        orderNumber: "LOAN/1",
        startMonth: opts.start,
        status: "RUNNING",
        createdById: "test",
        createdByName: "Test",
        recoveries: { create: opts.paid.map((m) => ({ runId: `seed-${m}`, month: m, principal: opts.instalment, interest: 0 })) },
      },
    });
  }

  async function leave(employeeId: string, opening: number, credit?: { period: string; date: string; days: number }) {
    await db.leaveLedger.create({ data: { boardId, employeeId, leaveCode: "EL", date: new Date("2018-12-31T00:00:00Z"), kind: "OPENING", days: opening, period: `opening-${employeeId}` } });
    if (credit) await db.leaveLedger.create({ data: { boardId, employeeId, leaveCode: "EL", date: new Date(`${credit.date}T00:00:00Z`), kind: "CREDIT", days: credit.days, period: credit.period } });
  }

  async function leaves(employeeId: string, lastDay: string, kind = "RESIGNATION") {
    const sep = await proposeSeparation(hr, employeeId, { kind, effectiveDate: lastDay, orderNumber: `EST/${uid()}`, orderDate: lastDay, reason: "Accepted by the competent authority" });
    await approveAll(sep.id);
    return sep;
  }

  beforeAll(async () => {
    boardId = (await db.board.create({ data: { code: `T${uid()}`, name: "Test Cantonment Board", nameHi: "परीक्षण छावनी परिषद" } })).id;
    await seedPayrollRules(db, boardId);
    await seedLeaveTypes(db, boardId);
    sectionId = (await makeSection(boardId)).id;
    postId = (await makePost(boardId, "6")).id;
    hr = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["HR"])).id);
    payroll = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["PAYROLL"])).id);
    checker = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["CHECKER"])).id);
    approver = await actorFor((await makeUser(boardId, "ADMIN", ["APPROVER"])).id);
    signer = await actorFor((await makeUser(boardId, "ADMIN", ["APPROVER", "PAY_BILL_SIGNER"])).id);
  });

  it("records a resignation through a Checker and an Admin; the person leaves the rolls after the last day", async () => {
    const e = await person();
    const input = { kind: "RESIGNATION", effectiveDate: "2019-03-20", orderNumber: "EST/12", orderDate: "2019-03-01", reason: "Resigned to join another service" };
    await expect(proposeSeparation(payroll, e.id, input)).rejects.toMatchObject({ status: 403 });
    const self = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["HR"], e.id)).id);
    await expect(proposeSeparation(self, e.id, input)).rejects.toMatchObject({ key: "errors.ownPay" });
    await expect(proposeSeparation(hr, e.id, { ...input, effectiveDate: "2041-01-01" })).rejects.toMatchObject({ fields: { effectiveDate: "employees.exit.errors.tooFar" } });
    const sep = await proposeSeparation(hr, e.id, input);
    await expect(proposeSeparation(hr, e.id, input)).rejects.toMatchObject({ key: "employees.exit.errors.waiting" });
    expect((await currentSeparation(hr, e.id))?.status).toBe("PENDING");
    const first = await db.approvalTask.findFirstOrThrow({ where: { entityId: sep.id, status: "PENDING" } });
    expect(first.requiredPermission).toBe("CHECKER");
    await decide(checker, first.id, "APPROVE");
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("ACTIVE");
    await approveAll(sep.id);
    const after = await db.employee.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.status).toBe("RESIGNED");
    expect(after.exitDate?.toISOString().slice(0, 10)).toBe("2019-03-20");
    expect(await db.serviceBookEntry.count({ where: { employeeId: e.id, event: "EXIT", status: "APPROVED" } })).toBe(1);
    expect((await getSeparation(hr, sep.id)).status).toBe("APPROVED");
  });

  it("works out the settlement: leave encashment against every loan, pay drawn after the last day and recoveries to come", async () => {
    const e = await person();
    await leave(e.id, 100, { period: "2019-H1", date: "2019-01-01", days: 15 });
    const l1 = await loan(e.id, { principal: 50000, instalment: 5000, start: "2018-10", paid: ["2018-10", "2018-11", "2018-12", "2019-01", "2019-02"] });
    const l2 = await loan(e.id, { principal: 12000, instalment: 1000, rate: 10, start: "2019-01", paid: ["2019-01", "2019-02"] });
    await db.employeePayItem.create({ data: { boardId, employeeId: e.id, headCode: "RECOVERY", amount: 500, fromMonth: "2019-01", toMonth: "2019-08", note: "Excess HRA", createdById: "test" } });
    // March paid in full before the leaving was recorded; April too.
    await slip(e.id, "2019-03", { days: 31, dim: 31, net: 62000 });
    await slip(e.id, "2019-04", { days: 30, dim: 30, net: 60000 });
    const sep = await leaves(e.id, "2019-03-20");
    await expect(settlementView(hr, sep.id)).rejects.toMatchObject({ status: 403 });
    await saveSettlementInputs(payroll, sep.id, { lines: [{ kind: "RECOVERY", label: "Stores — tools not returned", amount: 750 }] });
    const v = (await settlementView(payroll, sep.id))!;
    const st = v.statement;
    const by = (key: string) => st.lines.find((l) => l.key.startsWith(key));
    // 115 days at credit less 10 of the half-year's 15 not earned (only January and February completed) → half of 105.
    expect(st.leave).toMatchObject({ balance: 115, notEarned: 10, ruleDays: 52.5, days: 52.5, pay: 35400, daPercent: 12, withDa: 39648, amount: 69384 });
    expect(by("leave")?.amount).toBe(69384);
    expect(by(`loan:${l1.id}`)).toMatchObject({ amount: 25000, loan: { principal: 25000, interest: 0 } });
    const p2 = loanPosition(loanTermsOf({ principal: 12000, interestRate: 10, instalmentAmount: 1000, startMonth: "2019-01" }), [{ month: "2019-01", principal: 1000, interest: 0 }, { month: "2019-02", principal: 1000, interest: 0 }], st.month);
    expect(by(`loan:${l2.id}`)).toMatchObject({ amount: p2.principalLeft + p2.interestLeft, loan: { principal: 10000 } });
    expect(p2.interestLeft).toBeGreaterThan(0);
    // 11 of 31 days of March, all of April.
    expect(st.lines.filter((l) => l.source === "OVERPAID").map((l) => l.amount)).toEqual([22000, 60000]);
    expect(st.lines.find((l) => l.source === "ITEM")?.amount).toBe(2500);
    expect(st.lines.find((l) => l.source === "MANUAL")).toMatchObject({ kind: "RECOVERY", amount: 750 });
    expect(st.totals.recoveries).toBe(25000 + p2.principalLeft + p2.interestLeft + 22000 + 60000 + 2500 + 750);
    expect(st.totals.toRecover).toBe(st.totals.recoveries - 69384);
    expect(st.waitFor).toEqual([]);
    expect(v.canSubmit).toBe(true);

    // Recoveries above the dues: the Checker and the Admin approve, then the person pays it back in two receipts.
    await expect(submitSettlement(hr, sep.id, {})).rejects.toMatchObject({ status: 403 });
    await submitSettlement(payroll, sep.id, { note: "Please check" });
    await expect(saveSettlementInputs(payroll, sep.id, {})).rejects.toMatchObject({ key: "payroll.settlement.errors.notDraft" });
    await approveAll(sep.id);
    const approved = (await settlementView(payroll, sep.id))!;
    expect(approved.status).toBe("APPROVED");
    expect(approved.frozen).toBe(true);
    await expect(makeSettlementBill(payroll, sep.id)).rejects.toMatchObject({ key: "payroll.settlement.errors.nothingToPay" });
    const due = approved.statement.totals.toRecover;
    await expect(recordReceipt(payroll, sep.id, { receiptNo: "R-1", date: "2019-05-02", amount: due + 1 })).rejects.toMatchObject({ fields: { amount: "payroll.settlement.errors.moreThanDue" } });
    expect(await recordReceipt(payroll, sep.id, { receiptNo: "R-1", date: "2019-05-02", amount: 10000 })).toEqual({ settled: false });
    expect(await recordReceipt(payroll, sep.id, { receiptNo: "R-2", date: "2019-05-09", amount: due - 10000 })).toEqual({ settled: true });
    const done = await db.separation.findUniqueOrThrow({ where: { id: sep.id } });
    expect(done.settlementStatus).toBe("SETTLED");
    for (const id of [l1.id, l2.id]) {
      const l = await db.loan.findUniqueOrThrow({ where: { id }, include: { recoveries: true } });
      expect(l.status).toBe("CLOSED");
      expect(l.recoveries.some((r) => r.runId === `settlement:${sep.id}`)).toBe(true);
    }
  });

  it("pays the net by a settlement bill whose approval closes the loans and the GPF account; reopening undoes it", async () => {
    const e = await person();
    await leave(e.id, 300);
    const l = await loan(e.id, { principal: 20000, instalment: 2000, start: "2018-12", paid: ["2018-12", "2019-01", "2019-02", "2019-03", "2019-04"] });
    await db.gpfEntry.create({ data: { boardId, employeeId: e.id, month: "2019-03", fy: "2018-19", kind: "OPENING", amount: 40000, note: "Opening" } });
    // April's pay was withheld (no bank then); May was paid for the ten days up to the last day.
    const held = await slip(e.id, "2019-04", { days: 30, dim: 30, withheld: "NO_BANK" });
    await slip(e.id, "2019-05", { days: 10, dim: 31 });
    const sep = await leaves(e.id, "2019-05-10");
    const v = (await settlementView(payroll, sep.id))!;
    // Resignation: half of 300, at most 150 days; DA on 10 May 2019 was 12%.
    expect(v.statement.leave).toMatchObject({ ruleDays: 150, amount: 198240 });
    // Withheld pay comes back after its own deductions; its loan instalment is left to the loan line (taken whole).
    expect(v.statement.withheld).toEqual([expect.objectContaining({ slipId: held.id, release: true, due: 35400 + 4248 - 3000 })]);
    expect(v.statement.lines.find((x) => x.source === "LOAN")?.amount).toBe(10000);
    const net = 198240 + 36648 - 10000;
    expect(v.statement.totals).toMatchObject({ payable: net, toRecover: 0 });
    expect(v.statement.gpf?.balance).toBe(40000);

    expect((await withheldCandidates(payroll, "OPS")).some((c) => c.id === held.id)).toBe(true);
    await submitSettlement(payroll, sep.id, {});
    // Once the statement counts it, the withheld pay cannot also go into a "Pay withheld earlier" bill.
    expect((await withheldCandidates(payroll, "OPS")).some((c) => c.id === held.id)).toBe(false);
    await approveAll(sep.id);
    expect(await db.gpfEntry.count({ where: { employeeId: e.id, kind: "WITHDRAWAL" } })).toBe(0);
    const bill = await makeSettlementBill(payroll, sep.id);
    await expect(makeSettlementBill(payroll, sep.id)).rejects.toMatchObject({ key: "payroll.settlement.errors.billExists" });
    const data = await getRun(payroll, bill.id);
    const s = data.people[0];
    expect(s.net).toBe(net);
    const amount = (code: string) => s.lines.find((x) => x.code === code)?.amount;
    expect([amount("LEAVE_ENCASHMENT"), amount("BASIC"), amount("GPF"), amount("LOAN")]).toEqual([198240, 35400, 3000, 10000]);
    expect(data.open).toBe(0);
    // The withheld slip is now taken by the settlement bill.
    expect((await withheldCandidates(payroll, "OPS")).some((c) => c.id === held.id)).toBe(false);

    await submitRun(payroll, bill.id, {});
    await checkRun(checker, bill.id, { decision: "APPROVE" });
    const otp = await startSigning(signer, bill.id, meta);
    await approveRun(signer, bill.id, { decision: "APPROVE", challengeId: otp.challengeId, otp: otp.devOtp });
    expect((await db.separation.findUniqueOrThrow({ where: { id: sep.id } })).settlementStatus).toBe("SETTLED");
    expect((await db.loan.findUniqueOrThrow({ where: { id: l.id } })).status).toBe("CLOSED");
    // GPF: the subscription in the released pay is credited, then the final payment takes the whole balance.
    const gpf = await db.gpfEntry.findMany({ where: { employeeId: e.id } });
    expect(gpf.find((g) => g.kind === "WITHDRAWAL")?.runId).toBe(bill.id);
    expect(gpf.reduce((t, g) => t + Number(g.amount), 0)).toBeCloseTo(0, 2);

    await reopenRun(signer, bill.id, { note: "Leave days to be checked again" });
    expect((await db.separation.findUniqueOrThrow({ where: { id: sep.id } })).settlementStatus).toBe("APPROVED");
    expect((await db.loan.findUniqueOrThrow({ where: { id: l.id } })).status).toBe("RUNNING");
    expect(await db.gpfEntry.count({ where: { employeeId: e.id, kind: "WITHDRAWAL" } })).toBe(0);
  });

  it("waits for the month of leaving to be paid before the settlement can be sent", async () => {
    const e = await person();
    const sep = await leaves(e.id, "2019-07-15");
    const v = (await settlementView(payroll, sep.id))!;
    expect(v.statement.waitFor.map((w) => w.title)).toEqual(["Payroll July 2019 — Permanent – OPS"]);
    expect(v.canSubmit).toBe(false);
    await expect(submitSettlement(payroll, sep.id, {})).rejects.toMatchObject({ key: "payroll.settlement.errors.waitFor" });
  });

  it("suspends and reinstates through a Checker and an Admin; the loans on record are shown meanwhile", async () => {
    const e = await person();
    await loan(e.id, { principal: 6000, instalment: 1000, start: "2026-01", paid: ["2026-01", "2026-02"] });
    const today = todayIST();
    await expect(proposeSeparation(hr, e.id, { kind: "SUSPENSION", effectiveDate: addDays(today, 3), orderNumber: "VIG/7", orderDate: today, reason: "Pending inquiry" })).rejects.toMatchObject({ fields: { effectiveDate: "employees.exit.errors.suspensionFuture" } });
    const sep = await proposeSeparation(hr, e.id, { kind: "SUSPENSION", effectiveDate: addDays(today, -10), orderNumber: "VIG/7", orderDate: addDays(today, -10), reason: "Pending inquiry" });
    await approveAll(sep.id);
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("SUSPENDED");
    await expect(proposeSeparation(hr, e.id, { kind: "SUSPENSION", effectiveDate: today, orderNumber: "VIG/8", orderDate: today, reason: "Again" })).rejects.toMatchObject({ fields: { kind: "employees.exit.errors.alreadySuspended" } });
    const dues = await duesOnRecord(payroll, e.id);
    expect(dues?.total).toBe(4000);
    expect(await duesOnRecord(hr, e.id)).toBeNull();
    await expect(proposeReinstatement(hr, sep.id, { reinstatedOn: addDays(today, -10), orderNumber: "VIG/9", orderDate: today, note: "Inquiry closed" })).rejects.toMatchObject({ fields: { reinstatedOn: "employees.exit.errors.reinstateBefore" } });
    await proposeReinstatement(hr, sep.id, { reinstatedOn: today, orderNumber: "VIG/9", orderDate: today, note: "Inquiry closed; period treated as duty" });
    await approveAll(sep.id);
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("ACTIVE");
    const ended = await db.separation.findUniqueOrThrow({ where: { id: sep.id } });
    expect(ended.status).toBe("ENDED");
    expect(ended.endDate?.toISOString().slice(0, 10)).toBe(addDays(today, -1));
    expect((await db.serviceBookEntry.findMany({ where: { employeeId: e.id }, select: { event: true } })).map((x) => x.event).sort()).toEqual(["REINSTATEMENT", "SUSPENSION"]);
  });

  it("shows each block of the one-screen view only to logins whose rights cover it", async () => {
    const e = await person();
    await loan(e.id, { principal: 3000, instalment: 1000, start: "2026-01", paid: [] });
    const forHr = await employeeOverview(hr, e.id);
    expect(forHr.pay).toBeNull();
    expect(forHr.loans).toBeNull();
    expect(forHr.leave).not.toBeNull();
    expect(forHr.facts.service.years).toBeGreaterThanOrEqual(18);
    const forPayroll = await employeeOverview(payroll, e.id);
    expect(forPayroll.loans?.map((x) => x.left)).toEqual([3000]);
    expect(forPayroll.pay).not.toBeNull();
  });

  it("shows one employee for a chosen month or financial year: that month's slip, the year month by month with totals", async () => {
    const e = await person();
    await slip(e.id, "2019-05", { days: 31, dim: 31 });
    await slip(e.id, "2019-06", { days: 30, dim: 30 });
    await slip(e.id, "2020-01", { days: 31, dim: 31 });
    await db.attendanceMonth.create({ data: { boardId, employeeId: e.id, sectionId, month: "2019-06", daysInMonth: 30, daysOnRoll: 30, present: 24, late: 1, halfDays: 0, onDuty: 0, leave: 2, holidays: 0, weeklyOffs: 4, diesNon: 0, payableDays: 30, workedDays: 24 } });
    await db.leaveApplication.create({ data: { boardId, employeeId: e.id, leaveCode: "CL", debitCode: "CL", fromDate: new Date("2019-06-10T00:00:00Z"), toDate: new Date("2019-06-11T00:00:00Z"), days: 2, debitDays: 2, reason: "Family function", status: "APPROVED", createdById: "test" } });
    const net = 35400 + 4248 - 3000 - 1000;

    const june = await employeeOverview(payroll, e.id, { view: "month", month: "2019-06" });
    expect(june.pay?.last).toMatchObject({ month: "2019-06", net });
    expect(june.attendance).toMatchObject({ month: "2019-06", present: 24, leave: 2 });
    expect(june.leave?.taken).toEqual([{ code: "CL", days: 2 }]);
    expect(june.pay?.year).toMatchObject({ fy: "2019-20", slips: 3, net: net * 3 });

    const july = await employeeOverview(payroll, e.id, { view: "month", month: "2019-07" });
    expect(july.pay?.last).toBeNull();
    expect(july.attendance).toBeNull();

    const year = await employeeOverview(payroll, e.id, { view: "year", fy: "2019-20" });
    expect(year.pay?.months).toHaveLength(12);
    expect(year.pay?.months?.find((m) => m.month === "2019-06")).toMatchObject({ bills: 1, net, attendance: { present: 24 } });
    expect(year.pay?.months?.find((m) => m.month === "2019-08")).toMatchObject({ bills: 0, net: 0, attendance: null });
    expect(year.pay?.year).toMatchObject({ gross: (35400 + 4248) * 3, funds: 9000, loans: 3000 });
    expect(year.leave?.taken).toEqual([{ code: "CL", days: 2 }]);

    expect((await payslipsOf(payroll, e.id, "2019-20"))?.map((x) => x.month)).toEqual(["2020-01", "2019-06", "2019-05"]);
    expect(await payslipsOf(payroll, e.id, "2020-21")).toEqual([]);
    expect(await payslipsOf(hr, e.id, "2019-20")).toBeNull();
    expect((await leaveApplicationsOf(hr, e.id, 2019))?.taken).toEqual([{ code: "CL", days: 2 }]);
    expect((await leaveApplicationsOf(hr, e.id, 2020))?.applications).toEqual([]);
  });

  it("finds a person by full name in any order, by part of the name or ID, and finds people who have left", async () => {
    const e = await person();
    const left = await person();
    await db.employee.update({ where: { id: left.id }, data: { status: "RESIGNED", exitDate: new Date("2020-01-31T00:00:00Z") } });
    const ids = async (q?: string) => (await listEmployees(hr, { q, pageSize: 200 })).rows.map((r) => r.id);
    expect(await ids(`exit ${e.lastName!.toLowerCase()}`)).toEqual([e.id]);
    expect(await ids(`${e.lastName} Exit`)).toEqual([e.id]);
    expect(await ids(e.employeeCode!.slice(-4))).toContain(e.id);
    expect(await ids(`Exit ${e.lastName} nobody`)).toEqual([]);
    // Searching looks through everyone; the plain list shows current staff only.
    expect(await ids(left.lastName!)).toEqual([left.id]);
    expect(await ids()).not.toContain(left.id);
  });

  it("files scanned service books by the Employee ID that starts each file name", async () => {
    const e = await person({ code: `SB${Date.now().toString().slice(-6)}` });
    const pdf = (name: string) => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])], name, { type: "application/pdf" });
    const out = await uploadServiceBooks(hr, [pdf(`${e.employeeCode} service book.pdf`), pdf("scan 0001.pdf"), pdf("ZZ999999.pdf"), new File(["hello"], `${e.employeeCode}.txt`, { type: "text/plain" })]);
    expect(out.map((o) => o.status)).toEqual(["saved", "noCode", "noEmployee", "badType"]);
    expect(await db.employeeDocument.count({ where: { employeeId: e.id, category: "SERVICE_BOOK" } })).toBe(1);
    await expect(uploadServiceBooks(payroll, [pdf(`${e.employeeCode}.pdf`)])).rejects.toMatchObject({ status: 403 });
  });

  it("checks the document type and its size limit", async () => {
    const e = await person();
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 10)], "photo.jpg", { type: "image/jpeg" });
    await expect(uploadDocument(hr, e.id, big, { category: "PHOTO", title: "Photo" })).rejects.toMatchObject({ key: "employees.errors.fileTooBig" });
    // A type not in the list (or not in use) is filed as "Other".
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])], "order.pdf", { type: "application/pdf" });
    expect((await uploadDocument(hr, e.id, pdf, { category: "NO_SUCH_TYPE", title: "Order" })).category).toBe("OTHER");
  });
});
