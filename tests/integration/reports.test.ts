import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fromISODate } from "@/lib/dates";
import { adminPanel, homeTiles } from "@/modules/home/service";
import { exportReport } from "@/modules/reports/export";
import { totalsOf } from "@/modules/reports/present";
import { REPORTS, reportsFor, runReport } from "@/modules/reports/registry";
import { seedPayrollRules } from "../../prisma/seed-payroll";
import { actorFor, hasTestDb, makeBoard, makePost, makeSection, makeUser } from "../support/factory";

type Actor = Awaited<ReturnType<typeof actorFor>>;

/**
 * S-70 / PRD §11: the 25 standard reports and the dashboards. The pay bills here are written straight into the tables
 * (the reports only read approved bills), in months no other test uses, and every report is read for one fresh section.
 */
describe.skipIf(!hasTestDb)("reports and dashboards (§11)", () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const M0 = "2018-07";
  const M1 = "2018-08";
  let boardId: string;
  let sectionId: string;
  let otherSectionId: string;
  let postId: string;
  let admin: Actor;
  let hr: Actor;
  let payroll: Actor;
  let pension: Actor;
  let settings: Actor;
  let officer: Actor;
  let staff: Actor;
  const ids = { nps: "", contract: "", retired: "", officer: "" };

  const lines = (basic: number, da: number, nps: number, it = 0) => [
    { code: "BASIC", name: "Basic pay", nameHi: "मूल वेतन", kind: "EARNING", amount: basic, accountHead: "A1" },
    { code: "DA", name: "Dearness allowance", nameHi: "महँगाई भत्ता", kind: "EARNING", amount: da, accountHead: "A2" },
    { code: "NPS", name: "NPS (employee)", nameHi: "एनपीएस (कर्मचारी)", kind: "DEDUCTION", amount: nps, accountHead: "D1" },
    { code: "IT", name: "Income tax", nameHi: "आयकर", kind: "DEDUCTION", amount: it, accountHead: "D2" },
    { code: "NPS_ER", name: "NPS (Board)", nameHi: "एनपीएस (बोर्ड)", kind: "EMPLOYER", amount: Math.round(nps * 1.4), accountHead: "E1" },
  ];

  /** An approved, paid regular bill with one slip per person given. */
  async function paidBill(payGroup: "NPS" | "OPS" | "CONTRACT", month: string, people: { employeeId: string; basic: number; da: number; nps: number; it?: number }[]) {
    const run = await db.payrollRun.create({ data: { boardId, payGroup, month, status: "PAID", runById: payroll.userId, runByName: "Test", runAt: new Date(), approvedAt: new Date(), paidAt: new Date() } });
    for (const p of people) {
      const l = lines(p.basic, p.da, p.nps, p.it ?? 0);
      const gross = p.basic + p.da;
      const deductions = p.nps + (p.it ?? 0);
      await db.payslip.create({
        data: { boardId, runId: run.id, employeeId: p.employeeId, month, payGroup, sectionId, postId, daysInMonth: 31, daysOnRoll: 31, lines: l, gross, deductions, net: gross - deductions, employer: Math.round(p.nps * 1.4), creditStatus: "CREDITED" },
      });
    }
    return run;
  }

  beforeAll(async () => {
    boardId = (await makeBoard()).id;
    await seedPayrollRules(db, boardId);
    sectionId = (await makeSection(boardId)).id;
    otherSectionId = (await makeSection(boardId)).id;
    postId = (await makePost(boardId, "6")).id;
    const base = { boardId, gender: "M", sectionId, postId, dateOfBirth: fromISODate("1985-01-01"), dateOfJoining: fromISODate("2015-01-01"), dateOfRetirement: fromISODate("2045-01-31") };
    ids.nps = (await db.employee.create({ data: { ...base, type: "PERMANENT_NPS", status: "ACTIVE", employeeCode: `RP1${stamp}`, firstName: "Nidhi", lastName: "Report", panHash: `PAN-${stamp}`, bankAccountHash: `B1-${stamp}`, ifsc: "SBIN0001234", pran: null } })).id;
    ids.contract = (await db.employee.create({ data: { ...base, type: "CONTRACT", status: "ACTIVE", employeeCode: `RP2${stamp}`, firstName: "Chetan", lastName: "Report", panHash: `PAN2-${stamp}`, aadhaarHash: `AA-${stamp}`, bankAccountHash: `B2-${stamp}`, ifsc: "SBIN0001234", uan: "100200300400" } })).id;
    ids.retired = (await db.employee.create({ data: { ...base, type: "PERMANENT_OPS", status: "RETIRED", employeeCode: `RP3${stamp}`, firstName: "Ram", lastName: "Retired", dateOfBirth: fromISODate("1957-12-10"), dateOfRetirement: fromISODate("2017-12-31"), exitDate: fromISODate("2017-12-31") } })).id;
    ids.officer = (await db.employee.create({ data: { ...base, type: "PERMANENT_NPS", status: "ACTIVE", employeeCode: `RP4${stamp}`, firstName: "Omkar", lastName: "Officer", aadhaarHash: `AO-${stamp}`, panHash: `PO-${stamp}`, bankAccountHash: `B4-${stamp}`, ifsc: "SBIN0001234", pran: "110022003300" } })).id;

    admin = await actorFor((await makeUser(boardId, "ADMIN", ["APPROVER", "PAY_BILL_SIGNER"])).id);
    hr = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["HR"])).id);
    payroll = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["PAYROLL"])).id);
    pension = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["PENSION"])).id);
    settings = await actorFor((await makeUser(boardId, "ADMIN", ["USER_SETTINGS_MANAGER"])).id);
    officer = await actorFor((await makeUser(boardId, "EMPLOYEE", ["REPORTING_OFFICER"], ids.officer)).id);
    staff = await actorFor((await makeUser(boardId, "EMPLOYEE", [], ids.nps)).id);

    // The retired man's pension is paid into the contract worker's bank account.
    await db.pensioner.create({ data: { boardId, employeeId: ids.retired, ppoNumber: `RP/PPO/${stamp}`, type: "SUPERANNUATION", payeeName: "Ram Retired", payeeDob: fromISODate("1957-12-10"), basicPension: 15000, startDate: fromISODate("2018-01-01"), bankAccountHash: `B2-${stamp}` } });
    // Last month and this month for the NPS employee (₹1,500 more this month); pay to someone who retired in 2017.
    await paidBill("NPS", M0, [{ employeeId: ids.nps, basic: 30000, da: 14000, nps: 4400 }]);
    await paidBill("NPS", M1, [{ employeeId: ids.nps, basic: 31000, da: 14500, nps: 4550, it: 1000 }]);
    await paidBill("OPS", M1, [{ employeeId: ids.retired, basic: 20000, da: 9000, nps: 0 }]);
    // The August bill read July's attendance: on the rolls all month, not a day present.
    await db.attendanceMonth.create({ data: { boardId, employeeId: ids.nps, sectionId, month: M0, daysInMonth: 31, daysOnRoll: 31, present: 0, late: 0, halfDays: 0, onDuty: 0, leave: 0, holidays: 0, weeklyOffs: 5, diesNon: 26, payableDays: 5, workedDays: 0 } });
    // A ₹12,000 interest-free advance at ₹1,000 a month from July; two instalments recovered.
    const loan = await db.loan.create({ data: { boardId, employeeId: ids.nps, type: "FESTIVAL", principal: 12000, instalments: 12, instalmentAmount: 1000, sanctionDate: fromISODate("2018-06-20"), startMonth: M0, status: "RUNNING", createdById: payroll.userId, createdByName: "Test" } });
    const runs = await db.payrollRun.findMany({ where: { boardId, payGroup: "NPS", month: { in: [M0, M1] } }, select: { id: true, month: true } });
    for (const r of runs) await db.loanRecovery.create({ data: { loanId: loan.id, runId: r.id, month: r.month, principal: 1000, interest: 0 } });
  });

  it("§14: a report needs the Reports right and the view right of what it reads; officers see their own section only", async () => {
    const nos = (a: Actor) => reportsFor(a).map((r) => r.no);
    expect(REPORTS.map((r) => r.no)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(nos(admin)).toHaveLength(25);
    expect(nos(hr)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(nos(payroll)).toContain(11);
    expect(nos(payroll)).not.toContain(24);
    expect(nos(pension)).toEqual([1, 2, 3, 4, 5, 24]);
    expect(nos(settings)).toEqual([]);
    expect(nos(staff)).toEqual([]);
    await expect(runReport(hr, "salary-register", {})).rejects.toMatchObject({ status: 403 });
    await expect(runReport(staff, "employee-list", {})).rejects.toMatchObject({ status: 403 });
    await expect(runReport(admin, "no-such-report", {})).rejects.toMatchObject({ status: 404 });

    // The officer asks for another section and still gets their own.
    const r = await runReport(officer, "employee-list", { month: M1, section: otherSectionId });
    expect(r.lockedSectionId).toBe(sectionId);
    expect(r.filters.sectionId).toBe(sectionId);
    expect(r.result.rows.map((x) => x.code).sort()).toEqual([`RP1${stamp}`, `RP2${stamp}`, `RP4${stamp}`]);
  });

  it("every report runs for the chosen month, section and type; bad filters fall back to the defaults", async () => {
    for (const def of REPORTS) {
      const r = await runReport(admin, def.key, { month: M1, section: sectionId, type: "PERMANENT_NPS" });
      expect(r.result.columns.length, def.key).toBeGreaterThan(0);
      for (const row of r.result.rows) for (const c of r.result.columns) expect(typeof row[c.key] === "object" && row[c.key] !== null, `${def.key}.${c.key}`).toBe(false);
    }
    const r = await runReport(admin, "employee-list", { month: "13-2018", section: "nope", type: "WIZARD" });
    expect(r.filters).toMatchObject({ sectionId: null, type: null });
    expect(r.filters.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it("11, 12, 13, 16: register, abstract, acquittance and deductions add up to the same bill", async () => {
    const f = { month: M1, section: sectionId };
    const reg = await runReport(payroll, "salary-register", f);
    const t = totalsOf(reg.result)!;
    expect(reg.result.rows).toHaveLength(2);
    expect(t).toMatchObject({ h_BASIC: 51000, h_DA: 23500, gross: 74500, deductions: 5550, net: 68950 });

    const bill = await runReport(payroll, "pay-bill", f);
    expect(totalsOf(bill.result)).toMatchObject({ earning: 74500, deduction: 5550, employer: Math.round(4550 * 1.4) });
    expect(bill.result.links?.some((l) => /\/api\/v1\/payroll\/runs\/.+\/print\/paybill$/.test(l.href))).toBe(true);

    const acq = await runReport(payroll, "acquittance", f);
    expect(totalsOf(acq.result)?.net).toBe(68950);

    const ded = await runReport(payroll, "deductions", f);
    expect(ded.result.rows.find((r) => r.code === "NPS")).toMatchObject({ NPS: 4550, OPS: 0, total: 4550 });
    expect(ded.result.rows.find((r) => r.code === "IT")).toMatchObject({ total: 1000 });
  });

  it("15, 17, 21: month-on-month change explains itself; loans as they stand; NPS with the missing PRAN flagged", async () => {
    const f = { month: M1, section: sectionId };
    const change = await runReport(payroll, "month-change", f);
    const nidhi = change.result.rows.find((r) => r.code === `RP1${stamp}`)!;
    expect(nidhi).toMatchObject({ was: 39600, is: 39950, diff: 350 });
    expect(String(nidhi.moved)).toContain("BASIC +1,000");
    expect(change.result.rows.find((r) => r.code === `RP3${stamp}`)).toMatchObject({ why: "NEW" });

    const loans = await runReport(payroll, "loans", f);
    expect(loans.result.rows).toEqual([expect.objectContaining({ code: `RP1${stamp}`, type: "FESTIVAL", recovered: 2000, principalLeft: 10000, left: 10000, instalmentsLeft: 10 })]);

    const nps = await runReport(payroll, "nps", f);
    expect(nps.result.rows).toEqual([expect.objectContaining({ code: `RP1${stamp}`, own: 4550, board: Math.round(4550 * 1.4), basicDa: 45500, _tone: "red" })]);
  });

  it("25: ghost check — a salary account that takes someone's pension, pay after retirement, pay with no attendance", async () => {
    // EM-03: the database itself refuses a second current employee with the same PAN.
    await expect(db.employee.update({ where: { id: ids.officer }, data: { panHash: `PAN-${stamp}` } })).rejects.toThrow(/Employee_active_pan_unique/);
    const r = await runReport(payroll, "ghost-check", { month: M1, section: sectionId });
    const found = r.result.rows.map((x) => `${x.check}:${x.code}`).sort();
    expect(found).toEqual([`BANK_WITH_PENSION:RP/PPO/${stamp}`, `BANK_WITH_PENSION:RP2${stamp}`, `NO_ATTENDANCE:RP1${stamp}`, `PAID_AFTER_EXIT:RP3${stamp}`].sort());
    expect(r.result.rows.find((x) => x.check === "PAID_AFTER_EXIT")).toMatchObject({ amount: 29000, _tone: "red" });
  });

  it("2, 5: headcount by type and missing identity numbers for the section", async () => {
    const head = await runReport(hr, "headcount", { month: M1, section: sectionId });
    expect(head.result.rows).toEqual([expect.objectContaining({ PERMANENT_NPS: 2, CONTRACT: 1, total: 3 })]);
    const miss = await runReport(hr, "missing-ids", { month: M1, section: sectionId });
    expect(miss.result.rows.find((r) => r.code === `RP1${stamp}`)).toMatchObject({ pan: "OK", aadhaar: "MISSING", pran: "MISSING", uan: null });
    expect(miss.result.rows.find((r) => r.code === `RP4${stamp}`)).toBeUndefined();
  });

  it("S-70 export: Excel and PDF of exactly what is shown, and the download is in the audit trail", async () => {
    const x = await exportReport(payroll, "salary-register", "xlsx", { month: M1, section: sectionId }, "en");
    expect(x.buffer.subarray(0, 2).toString()).toBe("PK");
    expect(x.fileName).toBe(`Report-11-salary-register-${M1}.xlsx`);
    const p = await exportReport(payroll, "attendance-register", "pdf", { month: M1, section: sectionId }, "hi");
    expect(p.buffer.subarray(0, 4).toString()).toBe("%PDF");
    const logged = await db.auditLog.findMany({ where: { boardId, userId: payroll.userId, action: "PRINT", entityType: "Report" } });
    expect(logged.map((l) => l.entityId).sort()).toEqual(["attendance-register", "salary-register"]);
  }, 60_000);

  it("§11 dashboards: Admin sees cost, headcount by type and retirements; an employee sees last net pay and requests", async () => {
    const panel = await adminPanel(admin);
    expect(panel?.headcount.find((h) => h.type === "PERMANENT_NPS")?.count).toBeGreaterThanOrEqual(2);
    expect(await adminPanel(payroll)).toBeNull();
    expect(await adminPanel(settings)).toBeNull();
    const adminTiles = (await homeTiles(admin)).map((t) => t.key);
    expect(adminTiles).toEqual(expect.arrayContaining(["salaryCost", "pensionCost", "retiring6", "payrollMonth"]));
    expect((await homeTiles(settings)).map((t) => t.key)).not.toContain("salaryCost");
    const mine = await homeTiles(staff);
    expect(mine.find((t) => t.key === "lastNetPay")).toMatchObject({ value: "₹39,950" });
    expect(mine.find((t) => t.key === "nextIncrement")?.value).toMatch(/Jan|Jul/);
    expect(mine.find((t) => t.key === "pendingRequests")).toMatchObject({ value: 0 });
  });
});
