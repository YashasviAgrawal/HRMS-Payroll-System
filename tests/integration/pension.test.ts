import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decide } from "@/lib/approvals/engine";
import { pensionOfUser } from "@/lib/auth/pensioner";
import { seal } from "@/lib/crypto";
import { db } from "@/lib/db";
import { addDays, datesOfMonth, endOfMonth, fromISODate, shiftMonth, todayIST } from "@/lib/dates";
import { buildSalaryBankFile } from "@/modules/payroll/pay";
import { computeRun, ratesOn, saveRun } from "@/modules/payroll/compute";
import type { PayLine } from "@/modules/payroll/engine";
import { myPensionSlips } from "@/modules/payroll/payslips";
import { getRun, runPayroll } from "@/modules/payroll/run";
import { computePensionArrears, makeBenefitsBill, makePensionArrearsBill } from "@/modules/pension/bills";
import { commutationFactorsOn } from "@/modules/pension/case-facts";
import { casesOverview, createCase, getCase, setNoDues, submitCase } from "@/modules/pension/cases";
import { applyRetirements, proposeEmployeeDeath, proposePensionerDeath, resetRetirementCheck } from "@/modules/pension/events";
import { addLifeCertificate, myLifeCertificate, submitLifeCertificate } from "@/modules/pension/life-certificates";
import { listPensioners, pensionerProfile, proposePensionerEdit } from "@/modules/pension/pensioners";
import { proposeCommutationTable } from "@/modules/pension/tables";
import { seedPayrollRules } from "../../prisma/seed-payroll";
import { seedPensionRules } from "../../prisma/seed-pension";
import { actorFor, hasTestDb, makeBoard, makePost, makeSection, makeUser } from "../support/factory";

type Actor = Awaited<ReturnType<typeof actorFor>>;
const pendingTask = (entityId: string) => db.approvalTask.findFirstOrThrow({ where: { entityId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
const line = (lines: unknown, code: string) => (lines as PayLine[]).find((l) => l.code === code)?.amount ?? 0;
const pdf = () => new File([Buffer.from("%PDF-1.4\n% life certificate\n")], "jp.pdf", { type: "application/pdf" });

describe.skipIf(!hasTestDb)("pension (§10, PN-01 to PN-12)", () => {
  const today = todayIST();
  const m2 = today.slice(0, 7);
  const m1 = shiftMonth(m2, -1);
  const m0 = shiftMonth(m2, -2);
  const stamp = Date.now().toString(36).toUpperCase();
  let boardId: string;
  let sectionId: string;
  let postId: string;
  let pension: Actor;
  let pension2: Actor;
  let payroll: Actor;
  let checker: Actor;
  let approver: Actor;
  const ids = { retired: "", held: "", selfP: "", heldP: "", spouse: "", caseEmp: "", deadEmp: "", retiring: "" };
  const runs: Record<string, string> = {};
  const bank = (n: string) => {
    const s = seal("bank", n);
    return { bankAccountEnc: s.enc, bankAccountHash: s.hash, bankAccountLast4: s.last4, ifsc: "SBIN0001234" };
  };

  /** A pension bill worked out by the engine, saved and marked paid (what the five stages end in). */
  async function paidPensionBill(month: string) {
    const computed = await computeRun(db, boardId, "PENSION", month);
    const run = await db.$transaction((tx) => saveRun(tx, pension, "PENSION", month, computed));
    await db.payrollRun.update({ where: { id: run.id }, data: { status: "PAID", approvedAt: new Date(), paidAt: new Date() } });
    runs[month] = run.id;
    return run.id;
  }

  beforeAll(async () => {
    boardId = (await makeBoard()).id;
    await seedPayrollRules(db, boardId);
    await seedPensionRules(db, boardId);
    sectionId = (await makeSection(boardId)).id;
    postId = (await makePost(boardId, "6")).id;
    pension = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["PENSION"])).id);
    pension2 = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["PENSION"])).id);
    payroll = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["PAYROLL"])).id);
    checker = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["CHECKER"])).id);
    approver = await actorFor((await makeUser(boardId, "ADMIN", ["APPROVER", "PAY_BILL_SIGNER"])).id);
    const base = { boardId, type: "PERMANENT_OPS" as const, gender: "M", sectionId, postId };
    ids.retired = (await db.employee.create({ data: { ...base, employeeCode: `PN1${stamp}`, status: "RETIRED", firstName: "Old", lastName: "Retiree", dateOfBirth: fromISODate("1950-03-15"), dateOfJoining: fromISODate("1975-04-01"), dateOfRetirement: fromISODate("2010-03-31"), exitDate: fromISODate("2010-03-31") } })).id;
    ids.held = (await db.employee.create({ data: { ...base, employeeCode: `PN2${stamp}`, status: "RETIRED", firstName: "Far", lastName: "Away", dateOfBirth: fromISODate("1944-01-10"), dateOfJoining: fromISODate("1966-01-01"), dateOfRetirement: fromISODate("2004-01-31"), exitDate: fromISODate("2004-01-31") } })).id;
    ids.spouse = (await db.familyMember.create({ data: { employeeId: ids.retired, name: "Smt. Asha Retiree", relation: "SPOUSE", gender: "F", dateOfBirth: fromISODate("1953-07-01"), isDependent: true } })).id;
    const y = Number(today.slice(0, 4));
    // A certificate given a month ago is good for every month of these tests; one from three years ago means held.
    ids.selfP = (await db.pensioner.create({ data: { boardId, employeeId: ids.retired, ppoNumber: `T/PPO/${stamp}/1`, type: "SUPERANNUATION", payeeName: "Old Retiree", payeeDob: fromISODate("1950-03-15"), basicPension: 20000, commutedAmount: 8000, commutationDate: fromISODate("2010-04-01"), startDate: fromISODate("2010-04-01"), mobile: "9811100001", ...bank("40211000111") } })).id;
    ids.heldP = (await db.pensioner.create({ data: { boardId, employeeId: ids.held, ppoNumber: `T/PPO/${stamp}/2`, type: "SUPERANNUATION", payeeName: "Far Away", payeeDob: fromISODate("1944-01-10"), basicPension: 10000, startDate: fromISODate("2004-02-01"), ...bank("40211000222") } })).id;
    await db.lifeCertificate.create({ data: { boardId, pensionerId: ids.selfP, source: "MANUAL", status: "VERIFIED", certifiedOn: fromISODate(addDays(today, -30)), enteredById: pension.userId } });
    await db.lifeCertificate.create({ data: { boardId, pensionerId: ids.heldP, source: "MANUAL", status: "VERIFIED", certifiedOn: fromISODate(`${y - 3}-11-15`), enteredById: pension.userId } });
  });

  afterAll(async () => {
    // Leave nobody on the rolls for the salary tests that follow.
    await db.employee.updateMany({ where: { id: { in: [ids.caseEmp, ids.deadEmp, ids.retiring].filter(Boolean) } }, data: { status: "RETIRED", exitDate: fromISODate("2001-01-31") } });
  });

  it("PN-02 to PN-04, PN-06: the pension bill — pension + DR + FMA; a pension held by the system for an overdue certificate", async () => {
    await paidPensionBill(m0);
    const rates = await ratesOn(boardId, `${m0}-01`, db);
    const slips = await db.payslip.findMany({ where: { runId: runs[m0] } });
    const self = slips.find((s) => s.pensionerId === ids.selfP)!;
    const dr = Math.round((20000 * rates.DA_PERCENT) / 100);
    // Commuted on 1 April 2010 → restored on 1 April 2025: nothing deducted now.
    expect([line(self.lines, "BASIC_PENSION"), line(self.lines, "DR"), line(self.lines, "FMA"), line(self.lines, "COMMUTATION")]).toEqual([20000, dr, 1000, 0]);
    expect(Number(self.net)).toBe(21000 + dr);
    const held = slips.find((s) => s.pensionerId === ids.heldP)!;
    expect(held.status).toBe("WITHHELD");
    // 82 years old: additional pension 20% from the month of the 80th birthday.
    expect(line(held.lines, "ADDL_PENSION")).toBe(2000);
    const ex = await db.payrollException.findFirstOrThrow({ where: { runId: runs[m0], code: "LIFE_CERTIFICATE" } });
    expect(ex).toMatchObject({ resolution: "WITHHELD", resolvedByName: "System" });
  });

  it("§14: pension bills are Pension's — Payroll cannot run one; the run screen shows payees by PPO", async () => {
    await expect(runPayroll(payroll, { payGroup: "PENSION", month: m2 })).rejects.toMatchObject({ status: 403 });
    const run = await getRun(pension, runs[m0]);
    expect(run.title).toContain("Pension bill");
    expect(run.people.map((p) => p.code).sort()).toEqual([`T/PPO/${stamp}/1`, `T/PPO/${stamp}/2`]);
    await expect(getRun(payroll, runs[m0])).rejects.toMatchObject({ status: 403 });
  });

  it("PN-06, PN-12: a Jeevan Pramaan certificate from the pensioner, checked by Pension; held months are paid with the next bill", async () => {
    const heldUser = await db.user.create({ data: { boardId, loginType: "EMPLOYEE", loginId: `T/PPO/${stamp}/2`, displayName: "Far Away", mobile: `98${String(Date.now()).slice(-8)}`, pensionerId: ids.heldP, mustChangePassword: false } });
    expect(await pensionOfUser(heldUser)).toMatchObject({ id: ids.heldP });
    const me = await actorFor(heldUser.id);
    expect(me).toMatchObject({ isPensioner: true, pensionerId: ids.heldP, isEmployee: false });
    expect((await myLifeCertificate(me)).lc.state).toBe("HELD");
    await submitLifeCertificate(me, { certifiedOn: addDays(today, -1), jpId: "JP-TEST-1" }, pdf());
    await expect(submitLifeCertificate(me, { certifiedOn: today, jpId: "JP-TEST-2" }, pdf())).rejects.toMatchObject({ status: 409 });
    const task = await pendingTask(ids.heldP);
    expect(task).toMatchObject({ kind: "pension.lifecert", requiredPermission: "PENSION" });
    await decide(pension, task.id, "APPROVE");
    expect((await myLifeCertificate(me)).lc.state).not.toBe("HELD");

    await paidPensionBill(m1);
    const held = await db.payslip.findFirstOrThrow({ where: { runId: runs[m1], pensionerId: ids.heldP } });
    expect(held.status).toBe("INCLUDED");
    const detail = held.detail as { catchUp?: { month: string; net: number }[] };
    expect(detail.catchUp?.map((c) => c.month)).toEqual([m0]);
    expect(Number(held.net)).toBe(detail.catchUp![0].net * 2);
    // The pensioner sees the paid slip; not the withheld one.
    expect((await myPensionSlips(me)).map((s) => s.month)).toEqual([m1]);
  });

  it("PN-12: the bank file pays the pensioner's own account, listed by PPO number", async () => {
    await db.payrollRun.update({ where: { id: runs[m1] }, data: { status: "APPROVED", paidAt: null } });
    const file = await buildSalaryBankFile(pension, runs[m1]);
    const preview = (file.meta as { preview: { columns: string[]; rows: string[][] } }).preview;
    expect(preview.columns[0]).toBe("PPO no.");
    expect(preview.rows.map((r) => r[0]).sort()).toEqual([`T/PPO/${stamp}/1`, `T/PPO/${stamp}/2`]);
    expect(preview.rows.find((r) => r[0].endsWith("/1"))![2]).toBe("••••0111");
    expect(file.fileName).toMatch(/^pension-/);
    // An Admin releasing the file pays the bill, as for salaries.
    await decide(approver, (await pendingTask(file.id)).id, "APPROVE");
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: runs[m1] } })).status).toBe("PAID");
  });

  it("PN-05: a dearness relief order dated back gives arrears for every pensioner, due vs drawn", async () => {
    const rates = await ratesOn(boardId, `${m0}-01`, db);
    const key = { boardId_key_effectiveFrom: { boardId, key: "DA_PERCENT", effectiveFrom: fromISODate(`${m0}-01`) } };
    const old = await db.payRate.findUnique({ where: key });
    await db.payRate.upsert({ where: key, create: { boardId, key: "DA_PERCENT", value: rates.DA_PERCENT + 4, effectiveFrom: fromISODate(`${m0}-01`) }, update: { value: rates.DA_PERCENT + 4 } });
    try {
      const arrears = await computePensionArrears(db, boardId, m0, m1, [ids.selfP, ids.heldP]);
      const self = arrears.find((a) => a.pensionerId === ids.selfP)!;
      expect(self.months.map((m) => [m.month, m.lines.map((l) => [l.code, l.diff])])).toEqual([
        [m0, [["DR", 800]]],
        [m1, [["DR", 800]]],
      ]);
      // The held pensioner was paid only in m1 (for m0 and m1 together): both months count once.
      const held = arrears.find((a) => a.pensionerId === ids.heldP)!;
      expect(held.months.map((m) => m.month)).toEqual([m0, m1]);
      expect(held.net).toBe(2 * Math.round(12000 * 0.04));
      const bill = await makePensionArrearsBill(pension, { fromMonth: m0, toMonth: m1, reason: "DR order dated back" });
      expect(bill).toMatchObject({ payGroup: "PENSION", kind: "SUPPLEMENTARY" });
      const slip = await db.payslip.findFirstOrThrow({ where: { runId: bill.id, pensionerId: ids.selfP } });
      expect(line(slip.lines, "DR")).toBe(1600);
      // Approved and paid: the same arrears are never worked out twice.
      await db.payrollRun.update({ where: { id: bill.id }, data: { status: "PAID", approvedAt: new Date(), paidAt: new Date() } });
      expect(await computePensionArrears(db, boardId, m0, m1, [ids.selfP, ids.heldP])).toEqual([]);
    } finally {
      // Back to the rates the rest of the tests expect.
      if (old) await db.payRate.update({ where: key, data: { value: old.value } });
      else await db.payRate.delete({ where: key });
      await db.payslip.deleteMany({ where: { run: { boardId, payGroup: "PENSION", kind: "SUPPLEMENTARY" } } });
      await db.payrollRun.deleteMany({ where: { boardId, payGroup: "PENSION", kind: "SUPPLEMENTARY" } });
    }
  });

  it("PN-01: a change to the record goes to a Checker; only what changed is sent", async () => {
    await expect(proposePensionerEdit(pension, ids.selfP, { payeeName: "Old Retiree", fmaEligible: true, basicPension: 20000, commutedAmount: 8000, commutationDate: "2010-04-01", reason: "No change" })).rejects.toMatchObject({ status: 400 });
    await proposePensionerEdit(pension, ids.selfP, { payeeName: "Old Retiree", mobile: "9811100009", fmaEligible: true, basicPension: 20000, commutedAmount: 8000, commutationDate: "2010-04-01", reason: "New mobile number" });
    const task = await pendingTask(ids.selfP);
    expect((task.details as { rows: { label: string }[] }).rows.map((r) => r.label)).toEqual(["Mobile"]);
    await expect(decide(pension, task.id, "APPROVE")).rejects.toMatchObject({ status: 403 });
    await decide(checker, task.id, "APPROVE");
    expect((await db.pensioner.findUniqueOrThrow({ where: { id: ids.selfP } })).mobile).toBe("9811100009");
  });

  it("PN-11: a pensioner's death — pension stops, family pension the next day, and the overpayment is recovered from it", async () => {
    const death = `${m1}-10`;
    await proposePensionerDeath(pension, ids.selfP, { dateOfDeath: death, note: "Death certificate no. 123", familyMemberId: ids.spouse, mobile: "9811100002", bankAccount: "40211000333", ifsc: "SBIN0001234" });
    const task = await pendingTask(ids.selfP);
    await decide(checker, task.id, "APPROVE");
    const old = await db.pensioner.findUniqueOrThrow({ where: { id: ids.selfP } });
    expect(old).toMatchObject({ status: "STOPPED" });
    const fp = await db.pensioner.findFirstOrThrow({ where: { previousId: ids.selfP } });
    // Emoluments taken as twice the pension: normal family pension 30% = 12,000 (the enhanced period ended long ago).
    expect(fp).toMatchObject({ ppoNumber: `T/PPO/${stamp}/1/F`, type: "FAMILY", relation: "SPOUSE", payeeName: "Smt. Asha Retiree", reducedPension: null });
    expect(Number(fp.basicPension)).toBe(12000);
    expect(fp.startDate.toISOString().slice(0, 10)).toBe(`${m1}-11`);
    expect((await db.employee.findUniqueOrThrow({ where: { id: ids.retired } })).status).toBe("DECEASED");
    // Paid in full for m1; due only to the 10th.
    const items = await db.employeePayItem.findMany({ where: { employeeId: ids.retired, headCode: "RECOVERY" }, orderBy: { fromMonth: "asc" } });
    const total = items.reduce((s, i) => s + Number(i.amount) * (1 + (i.toMonth && i.toMonth !== i.fromMonth ? Number(i.toMonth.slice(0, 4)) * 12 + Number(i.toMonth.slice(5)) - Number(i.fromMonth.slice(0, 4)) * 12 - Number(i.fromMonth.slice(5)) : 0)), 0);
    const dim = datesOfMonth(m1).length;
    const monthly = Number((await db.payslip.findFirstOrThrow({ where: { runId: runs[m1], pensionerId: ids.selfP } })).net);
    expect(Math.abs(total - (monthly * (dim - 10)) / dim)).toBeLessThan(4);
    expect(items[0].fromMonth).toBe(m2);
    expect(Number(items[0].amount)).toBeLessThanOrEqual(4000);
    expect((old.endDetail as { total: number }).total).toBe(Math.round(total * 100) / 100);

    const run = await paidPensionBill(m2);
    const slips = await db.payslip.findMany({ where: { runId: run } });
    expect(slips.some((s) => s.pensionerId === ids.selfP)).toBe(false);
    const fps = slips.find((s) => s.pensionerId === fp.id)!;
    expect((fps.detail as { catchUp?: { month: string }[] }).catchUp?.map((c) => c.month)).toEqual([m1]);
    expect(line(fps.lines, "RECOVERY")).toBe(Number(items[0].amount));
    expect(Math.round(line(fps.lines, "BASIC_PENSION"))).toBe(12000 + Math.round((12000 * (dim - 10)) / dim));
  });

  it("PN-07 to PN-10: a retirement case — calculator, no-dues, Checker then Admin, PPO, pension from the day after, benefits bill", async () => {
    const lastDay = endOfMonth(`${shiftMonth(m2, 1)}-01`);
    ids.caseEmp = (await db.employee.create({ data: { boardId, employeeCode: `PN3${stamp}`, type: "PERMANENT_OPS", status: "ACTIVE", firstName: "Case", lastName: "Retiring", gender: "F", sectionId, postId, payLevel: "6", payCell: 12, dateOfBirth: fromISODate(`${Number(lastDay.slice(0, 4)) - 60}-${lastDay.slice(5, 7)}-02`), dateOfJoining: fromISODate("1995-01-02"), dateOfRetirement: fromISODate(lastDay), ...bank("40211000444") } })).id;
    await db.familyMember.create({ data: { employeeId: ids.caseEmp, name: "Shri Ram Retiring", relation: "SPOUSE", gender: "M", dateOfBirth: fromISODate("1964-01-01"), isDependent: true } });
    await db.leaveLedger.create({ data: { boardId, employeeId: ids.caseEmp, leaveCode: "EL", date: fromISODate("2026-01-01"), kind: "CREDIT", days: 280, period: "test-el" } });
    await db.gpfEntry.create({ data: { boardId, employeeId: ids.caseEmp, month: "2025-03", fy: "2024-25", kind: "OPENING", amount: 300000, note: "Opening (test)" } });
    expect((await casesOverview(pension)).alerts.find((a) => a.employeeId === ids.caseEmp)).toMatchObject({ stage: "SIX", case: null });

    const { id } = await createCase(pension, { employeeId: ids.caseEmp, type: "SUPERANNUATION", commutationPct: 40, fmaEligible: true });
    await expect(createCase(pension2, { employeeId: ids.caseEmp, type: "SUPERANNUATION", commutationPct: 40 })).rejects.toMatchObject({ status: 409 });
    const draft = await getCase(pension, id);
    const basic = draft.working.sources.basic;
    expect(basic).toBeGreaterThan(30000);
    expect(draft.working.pension.amount).toBe(Math.ceil(basic / 2));
    expect(draft.working.commutation.monthly).toBe(Math.floor((draft.working.pension.amount * 40) / 100));
    expect(draft.working.leaveEncashment.days).toBe(280);
    expect(draft.working.pensionFrom).toBe(addDays(lastDay, 1));
    // GPF final payment: the balance with this year's interest to the month of retirement.
    expect(draft.working.sources.gpf.balance).toBe(300000);
    expect(draft.working.gpf).toBe(300000 + draft.working.sources.gpf.interest);
    expect(draft.working.sources.gpf.interest).toBeGreaterThan(0);

    await expect(submitCase(pension, id)).rejects.toMatchObject({ status: 400 });
    for (const [i, n] of draft.noDues.entries()) await setNoDues(pension, id, n.sectionId, i === 0 ? { status: "DUES", amount: 5000, note: "Library books not returned" } : { status: "CLEAR" });
    await submitCase(pension, id);
    const t1 = await pendingTask(id);
    await decide(checker, t1.id, "APPROVE");
    expect((await getCase(pension, id)).case.status).toBe("APPROVING");
    const t2 = await pendingTask(id);
    expect(t2.requiredPermission).toBe("APPROVER");
    await decide(approver, t2.id, "APPROVE");
    const done = await getCase(pension, id);
    expect(done.case.status).toBe("APPROVED");
    expect(done.case.ppoNumber).toMatch(new RegExp(`^DCB/PPO/${addDays(lastDay, 1).slice(0, 4)}/\\d{4}$`));
    const p = await db.pensioner.findUniqueOrThrow({ where: { id: done.case.pensionerId! } });
    expect(p).toMatchObject({ relation: "SELF", type: "SUPERANNUATION", caseId: id, bankAccountLast4: "0444" });
    expect(Number(p.basicPension)).toBe(done.working.pension.amount);
    expect(Number(p.commutedAmount)).toBe(done.working.commutation.monthly);
    expect(p.startDate.toISOString().slice(0, 10)).toBe(addDays(lastDay, 1));
    // The PPO is stored for physical signature.
    expect((await db.pensionCase.findUniqueOrThrow({ where: { id } })).ppoKey).toBeTruthy();

    const bill = await makeBenefitsBill(pension, id);
    const slip = await db.payslip.findFirstOrThrow({ where: { runId: bill.id } });
    expect(slip.pensionerId).toBe(p.id);
    expect(line(slip.lines, "GRATUITY")).toBe(done.working.gratuity.amount);
    expect(line(slip.lines, "COMMUTED_VALUE")).toBe(done.working.commutation.lumpSum);
    expect(line(slip.lines, "LEAVE_ENCASHMENT")).toBe(done.working.leaveEncashment.amount);
    expect(line(slip.lines, "RECOVERY")).toBe(5000);
    expect(Number(slip.net)).toBe(done.working.lumpSum - 5000);
    await expect(makeBenefitsBill(pension, id)).rejects.toMatchObject({ status: 409 });
    await db.payslip.deleteMany({ where: { runId: bill.id } });
    await db.payrollRun.delete({ where: { id: bill.id } });
    await db.pensionCase.update({ where: { id }, data: { benefitsRunId: null } });

    // Still serving at approval: the GPF account stays open until the day after retirement, then is closed once.
    expect(await db.gpfEntry.count({ where: { employeeId: ids.caseEmp, kind: "WITHDRAWAL" } })).toBe(0);
    resetRetirementCheck();
    await applyRetirements(boardId, addDays(lastDay, 1));
    const gpf = await db.gpfEntry.findMany({ where: { employeeId: ids.caseEmp }, orderBy: { createdAt: "asc" } });
    const withdrawal = gpf.find((g) => g.kind === "WITHDRAWAL")!;
    expect(withdrawal.note).toContain(done.case.ppoNumber!);
    expect(gpf.reduce((s, g) => s + Number(g.amount), 0)).toBeCloseTo(0, 2);
    expect(Number(withdrawal.amount)).toBeCloseTo(-(300000 + (gpf.find((g) => g.kind === "INTEREST") ? Number(gpf.find((g) => g.kind === "INTEREST")!.amount) : 0)), 2);
    resetRetirementCheck();
    await applyRetirements(boardId, addDays(lastDay, 2));
    expect(await db.gpfEntry.count({ where: { employeeId: ids.caseEmp, kind: "WITHDRAWAL" } })).toBe(1);
  });

  it("PN-10: the day after retirement the employee leaves the rolls, with a service book entry", async () => {
    ids.retiring = (await db.employee.create({ data: { boardId, employeeCode: `PN4${stamp}`, type: "PERMANENT_NPS", status: "ACTIVE", firstName: "Gone", lastName: "Home", gender: "M", sectionId, postId, payLevel: "6", payCell: 5, dateOfBirth: fromISODate("1960-06-15"), dateOfJoining: fromISODate("2005-01-01"), dateOfRetirement: fromISODate("2020-06-30") } })).id;
    resetRetirementCheck();
    expect(await applyRetirements(boardId)).toBeGreaterThanOrEqual(1);
    const e = await db.employee.findUniqueOrThrow({ where: { id: ids.retiring }, include: { serviceBook: true } });
    expect(e).toMatchObject({ status: "RETIRED", exitReason: "Superannuation" });
    expect(e.exitDate?.toISOString().slice(0, 10)).toBe("2020-06-30");
    expect(e.serviceBook.map((s) => s.event)).toContain("RETIREMENT");
  });

  it("PN-11: a death in service stops pay and starts a family pension case", async () => {
    ids.deadEmp = (await db.employee.create({ data: { boardId, employeeCode: `PN5${stamp}`, type: "PERMANENT_OPS", status: "ACTIVE", firstName: "Died", lastName: "Serving", gender: "M", sectionId, postId, payLevel: "6", payCell: 8, dateOfBirth: fromISODate("1975-02-02"), dateOfJoining: fromISODate("2000-01-03"), dateOfRetirement: fromISODate("2035-02-28") } })).id;
    const wife = await db.familyMember.create({ data: { employeeId: ids.deadEmp, name: "Smt. Widow Serving", relation: "SPOUSE", gender: "F", dateOfBirth: fromISODate("1978-03-03"), isDependent: true } });
    await proposeEmployeeDeath(pension, ids.deadEmp, { dateOfDeath: addDays(today, -3), note: "Death certificate DC-77", familyMemberId: wife.id, bankAccount: "40211000555", ifsc: "SBIN0001234" });
    await decide(checker, (await pendingTask(ids.deadEmp)).id, "APPROVE");
    const e = await db.employee.findUniqueOrThrow({ where: { id: ids.deadEmp } });
    expect(e).toMatchObject({ status: "DECEASED", exitReason: "Died in service" });
    const c = await db.pensionCase.findFirstOrThrow({ where: { employeeId: ids.deadEmp } });
    expect(c).toMatchObject({ type: "FAMILY", status: "DRAFT" });
    const w = (await getCase(pension, c.id)).working;
    expect(w.gratuity.kind).toBe("DEATH");
    expect(w.familyPension.enhanced).toBeGreaterThan(0);
    // Ten years at the enhanced rate after a death in service.
    expect(w.familyPension.enhancedUntil).toBe(addDays(`${Number(addDays(today, -2).slice(0, 4)) + 10}${addDays(today, -2).slice(4)}`, -1));
  });

  it("S-60: the list counts certificates due and held, and finds by PPO; a pensioner sees only their own profile", async () => {
    const list = await listPensioners(pension, { q: `T/PPO/${stamp}`, status: "ALL" });
    expect(list.rows.map((r) => r.ppoNumber).sort()).toEqual([`T/PPO/${stamp}/1`, `T/PPO/${stamp}/1/F`, `T/PPO/${stamp}/2`]);
    const fp = list.rows.find((r) => r.ppoNumber.endsWith("/F"))!;
    expect(fp.of).toBe("Old Retiree");
    const someone = await actorFor((await db.user.findFirstOrThrow({ where: { pensionerId: ids.heldP } })).id);
    expect((await pensionerProfile(someone, ids.heldP)).own).toBe(true);
    await expect(pensionerProfile(someone, fp.id)).rejects.toMatchObject({ status: 403 });
    await expect(listPensioners(someone)).rejects.toMatchObject({ status: 403 });
  });

  it("HR enters a certificate seen at the office; the commutation table changes only with an Admin", async () => {
    await expect(addLifeCertificate(pension, ids.heldP, { source: "JEEVAN_PRAMAAN", certifiedOn: today }, null)).rejects.toMatchObject({ issues: [expect.objectContaining({ message: "validation.required" })] });
    await addLifeCertificate(pension, ids.heldP, { source: "MANUAL", certifiedOn: today, note: "Came to the office" }, null);
    const factors: Record<string, number> = {};
    for (let a = 20; a <= 85; a++) factors[String(a)] = 9 - (a - 20) * 0.05;
    const from = addDays(today, 1);
    await proposeCommutationTable(pension, { effectiveFrom: from, factors, reason: "Revised table (test)" });
    const task = await db.approvalTask.findFirstOrThrow({ where: { boardId, kind: "pension.table", status: "PENDING" } });
    await expect(decide(checker, task.id, "APPROVE")).rejects.toMatchObject({ status: 403 });
    await decide(approver, task.id, "APPROVE");
    expect((await commutationFactorsOn(db, boardId, from)).factors["60"]).toBeCloseTo(7);
    expect((await commutationFactorsOn(db, boardId, today)).factors["60"]).toBe(8.287);
    await db.ruleTable.deleteMany({ where: { boardId, code: "COMMUTATION_FACTORS", effectiveFrom: fromISODate(from) } });
  });
});
