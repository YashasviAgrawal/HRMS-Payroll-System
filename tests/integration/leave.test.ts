import { beforeAll, describe, expect, it } from "vitest";
import { decide } from "@/lib/approvals/engine";
import { db } from "@/lib/db";
import { addDays, datesOfMonth, monthOf, shiftMonth, todayIST, weekday } from "@/lib/dates";
import { lockMonth, lockPreview } from "@/modules/attendance/service";
import { balancesFor, ensureCredits, ledgerBalances, resetCreditCheck } from "@/modules/leave/balance";
import { LEAVE_DEFAULTS } from "@/modules/leave/defaults";
import { submitOpening } from "@/modules/leave/opening";
import { applyLeave, cancelLeave, employeeLeave, enterLeave, previewLeave, proposeLeaveRule } from "@/modules/leave/service";
import { actorFor, hasTestDb, makeBoard, makeEmployee, makePost, makeSection, makeUser } from "../support/factory";

type Actor = Awaited<ReturnType<typeof actorFor>>;

describe.skipIf(!hasTestDb)("leave (LV-01…LV-07)", () => {
  let boardId: string;
  let section: string;
  let emp: string;
  let other: string;
  let staff: Actor;
  let officer: Actor;
  let hr: Actor;
  let checker: Actor;
  let approver: Actor;
  const today = todayIST();
  const nextMonth = shiftMonth(monthOf(today), 1);
  const working = datesOfMonth(nextMonth).filter((d) => weekday(d) >= 1 && weekday(d) <= 5);
  // A Friday and the Monday after it, for counting across a weekend.
  const friday = datesOfMonth(nextMonth).find((d) => weekday(d) === 5 && d >= `${nextMonth}-08`)!;
  const monday = addDays(friday, 3);

  beforeAll(async () => {
    boardId = (await makeBoard()).id;
    for (const [i, d] of LEAVE_DEFAULTS.entries()) {
      const data = {
        name: d.name,
        nameHi: d.nameHi,
        pay: d.pay,
        creditMode: d.creditMode,
        creditDays: d.creditDays,
        cap: d.cap ?? null,
        lapsesAtYearEnd: d.lapsesAtYearEnd ?? false,
        debitFrom: d.debitFrom ?? null,
        debitFactor: d.debitFactor ?? 1,
        countsOffDays: d.countsOffDays ?? true,
        halfDayAllowed: d.halfDayAllowed ?? false,
        needsCertificate: d.needsCertificate ?? false,
        restrictedOnly: d.restrictedOnly ?? false,
        gender: d.gender ?? null,
        employeeTypes: d.employeeTypes,
        officerLimitDays: d.officerLimitDays ?? null,
        sortOrder: i,
      };
      await db.leaveType.upsert({ where: { boardId_code: { boardId, code: d.code } }, create: { boardId, code: d.code, ...data }, update: data });
    }
    section = (await makeSection(boardId)).id;
    const postId = (await makePost(boardId)).id;
    emp = (await makeEmployee(boardId, { sectionId: section, postId })).id;
    other = (await makeEmployee(boardId, { sectionId: section, postId })).id;
    const head = (await makeEmployee(boardId, { sectionId: section, postId })).id;
    staff = await actorFor((await makeUser(boardId, "EMPLOYEE", [], emp)).id);
    officer = await actorFor((await makeUser(boardId, "EMPLOYEE", ["REPORTING_OFFICER"], head)).id);
    hr = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["HR"])).id);
    checker = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["CHECKER"])).id);
    approver = await actorFor((await makeUser(boardId, "ADMIN", ["APPROVER"])).id);
    resetCreditCheck();
    await ensureCredits(boardId, today);
  });

  const task = (entityId: string) => db.approvalTask.findFirstOrThrow({ where: { entityId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
  const balance = async (id: string, code: string) => (await ledgerBalances(id)).get(code) ?? 0;

  it("credits EL and HPL each half-year and CL and RH each year, once (LV-02)", async () => {
    expect(await balance(emp, "EL")).toBe(15);
    expect(await balance(emp, "HPL")).toBe(10);
    expect(await balance(emp, "CL")).toBe(8);
    expect(await balance(emp, "RH")).toBe(2);
    resetCreditCheck();
    await ensureCredits(boardId, today);
    expect(await balance(emp, "EL")).toBe(15);
    const e = await db.employee.findUniqueOrThrow({ where: { id: emp } });
    const kinds = (await balancesFor(e, boardId)).map((b) => b.code);
    expect(kinds).toContain("PTL"); // a man gets paternity leave…
    expect(kinds).not.toContain("ML"); // …not maternity leave
  });

  it("counts working days for CL but every day for EL, and shows the live balance (LV-03)", async () => {
    const cl = await previewLeave(staff, { leaveCode: "CL", fromDate: friday, toDate: monday, halfDay: false });
    expect(cl).toMatchObject({ days: 2, balance: 8, after: 6, decider: "REPORTING_OFFICER" });
    const el = await previewLeave(staff, { leaveCode: "EL", fromDate: friday, toDate: monday, halfDay: false });
    expect(el.days).toBe(4);
    expect((await previewLeave(staff, { leaveCode: "CL", fromDate: friday, toDate: friday, halfDay: true })).days).toBe(0.5);
    await expect(previewLeave(staff, { leaveCode: "EL", fromDate: friday, toDate: friday, halfDay: true })).rejects.toMatchObject({ key: "leave.errors.halfDayNotAllowed" });
    await expect(previewLeave(staff, { leaveCode: "ML", fromDate: friday, toDate: monday, halfDay: false })).rejects.toMatchObject({ key: "leave.errors.notEligible" });
    await expect(previewLeave(staff, { leaveCode: "CL", fromDate: working[0], toDate: working[9], halfDay: false })).rejects.toMatchObject({ key: "leave.errors.short" });
  });

  it("sends an application to the reporting officer, who approves it: balance down, days marked (LV-03, LV-04)", async () => {
    const a = await applyLeave(staff, { leaveCode: "CL", fromDate: friday, toDate: monday, reason: "Family function" });
    const t = await task(a.id);
    expect(t).toMatchObject({ kind: "leave.apply", requiredPermission: "REPORTING_OFFICER", sectionId: section });
    // Waiting days already count against what can still be asked for.
    await expect(applyLeave(staff, { leaveCode: "CL", fromDate: working[0], toDate: working[6], reason: "More" })).rejects.toMatchObject({ key: "leave.errors.short" });
    await expect(applyLeave(staff, { leaveCode: "EL", fromDate: monday, toDate: monday, reason: "Overlap" })).rejects.toMatchObject({ key: "leave.errors.overlap" });
    await expect(decide(staff, t.id, "APPROVE")).rejects.toMatchObject({ status: 403 });
    await decide(officer, t.id, "APPROVE");
    expect(await balance(emp, "CL")).toBe(6);
    const days = await db.attendanceDay.findMany({ where: { applicationId: a.id }, orderBy: { date: "asc" } });
    expect(days.map((d) => d.status)).toEqual(["LEAVE", "LEAVE"]); // Friday and Monday, not the weekend
    expect(days.every((d) => d.leaveCode === "CL" && d.source === "LEAVE")).toBe(true);

    // The employee changes their mind: the leave has not started, so they can cancel it.
    await cancelLeave(staff, a.id, { note: "Function postponed" });
    expect(await balance(emp, "CL")).toBe(8);
    expect(await db.attendanceDay.count({ where: { applicationId: a.id } })).toBe(0);
  });

  it("loads opening balances through a Checker and sends long leave to an Admin (LV-06, PRD §14)", async () => {
    const lastYearEnd = `${Number(today.slice(0, 4)) - 1}-12-31`;
    await submitOpening(hr, { asOn: lastYearEnd, rows: [{ employeeId: emp, leaveCode: "EL", days: 120 }, { employeeId: emp, leaveCode: "CCL", days: 30 }] });
    await expect(submitOpening(hr, { asOn: lastYearEnd, rows: [{ employeeId: emp, leaveCode: "EL", days: 1 }] })).rejects.toMatchObject({ key: "leave.opening.pending" });
    await decide(checker, (await task(lastYearEnd)).id, "APPROVE");
    expect(await balance(emp, "EL")).toBe(135);

    const long = await applyLeave(staff, { leaveCode: "EL", fromDate: working[0], toDate: addDays(working[0], 19), reason: "Native place visit" });
    expect((await task(long.id)).requiredPermission).toBe("APPROVER");
    await expect(decide(officer, (await task(long.id)).id, "APPROVE")).rejects.toMatchObject({ status: 403 });
    await decide(approver, (await task(long.id)).id, "APPROVE");
    expect(await balance(emp, "EL")).toBe(115);

    const ledger = await employeeLeave(staff, emp);
    const el = ledger.lines.filter((l) => l.code === "EL");
    expect(el.map((l) => l.kind)).toEqual(expect.arrayContaining(["OPENING", "CREDIT", "DEBIT"]));
    expect(el.at(-1)!.balance).toBe(115);
    await expect(employeeLeave(staff, other)).rejects.toMatchObject({ status: 403 });
    expect((await employeeLeave(officer, other)).employee.id).toBe(other);
  });

  it("takes commuted leave from HPL at 2 days per day, with a medical certificate", async () => {
    const day = working.at(-1)!;
    await expect(applyLeave(staff, { leaveCode: "CML", fromDate: day, toDate: day, reason: "Fever" })).rejects.toMatchObject({ key: "leave.errors.certificate" });
    const pdf = new File([Buffer.from("%PDF-1.4\n% medical certificate\n")], "certificate.pdf", { type: "application/pdf" });
    const a = await applyLeave(staff, { leaveCode: "CML", fromDate: day, toDate: day, reason: "Fever" }, pdf);
    expect(await db.leaveApplication.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ debitCode: "HPL" });
    await decide(officer, (await task(a.id)).id, "APPROVE");
    expect(await balance(emp, "HPL")).toBe(8);
  });

  it("lets HR enter paper-sanctioned leave, decided by the section's officer (LV-05)", async () => {
    await expect(enterLeave(hr, { employeeId: other, leaveCode: "CL", fromDate: friday, toDate: friday, reason: "Sick", sanctionRef: "" })).rejects.toThrow();
    const a = await enterLeave(hr, { employeeId: other, leaveCode: "CL", fromDate: friday, toDate: friday, reason: "Sick", sanctionRef: "Sanction 14/2026" });
    const t = await task(a.id);
    expect(t).toMatchObject({ kind: "leave.entry", requiredPermission: "REPORTING_OFFICER", sectionId: section });
    await expect(decide(checker, t.id, "APPROVE")).rejects.toMatchObject({ status: 403 });
    await decide(officer, t.id, "APPROVE");
    expect(await balance(other, "CL")).toBe(7);
  });

  it("changes the leave rules table only with an Admin's approval (LV-01)", async () => {
    const cl = await db.leaveType.findUniqueOrThrow({ where: { boardId_code: { boardId, code: "CL" } } });
    const proposal = { code: "CL", name: cl.name, nameHi: cl.nameHi, pay: cl.pay, creditMode: cl.creditMode, creditDays: 10, cap: null, lapsesAtYearEnd: true, countsOffDays: false, halfDayAllowed: true, needsCertificate: false, officerLimitDays: 8, isActive: true };
    await expect(proposeLeaveRule(staff, proposal)).rejects.toMatchObject({ status: 403 });
    await proposeLeaveRule(hr, proposal);
    await expect(proposeLeaveRule(hr, proposal)).rejects.toMatchObject({ key: "leave.errors.rulePending" });
    await expect(decide(checker, (await task("CL")).id, "APPROVE")).rejects.toMatchObject({ status: 403 });
    await decide(approver, (await task("CL")).id, "APPROVE");
    const after = await db.leaveType.findUniqueOrThrow({ where: { boardId_code: { boardId, code: "CL" } } });
    expect(Number(after.creditDays)).toBe(10);
    expect(after.version).toBe(cl.version + 1);
  });

  it("lets the officer treat an unexplained day as leave at the month lock, with its pay effect (AT-05, LV-04)", async () => {
    const lastMonth = shiftMonth(monthOf(today), -1);
    const preview = await lockPreview(officer, section, lastMonth);
    const mine = preview.exceptions.filter((x) => x.employeeId === emp);
    expect(mine.length).toBeGreaterThan(2);
    expect(preview.leaveChoices[emp].map((c) => c.code)).toEqual(expect.arrayContaining(["CL", "EL", "EOL"]));
    const resolutions = preview.exceptions.map((x, i) =>
      x.employeeId === emp && i === preview.exceptions.indexOf(mine[0])
        ? { employeeId: x.employeeId, date: x.date, outcome: "LEAVE" as const, leaveCode: "CL" }
        : x.employeeId === emp && i === preview.exceptions.indexOf(mine[1])
          ? { employeeId: x.employeeId, date: x.date, outcome: "LEAVE" as const, leaveCode: "EOL" }
          : { employeeId: x.employeeId, date: x.date, outcome: "PRESENT" as const },
    );
    await expect(lockMonth(officer, { sectionId: section, month: lastMonth, resolutions: resolutions.map((r) => ("leaveCode" in r ? { ...r, leaveCode: "ML" } : r)) })).rejects.toMatchObject({
      key: "attendance.errors.leaveNotAllowed",
    });
    const before = await balance(emp, "CL");
    await lockMonth(officer, { sectionId: section, month: lastMonth, resolutions });
    expect(await balance(emp, "CL")).toBe(before - 1);
    const m = await db.attendanceMonth.findUniqueOrThrow({ where: { employeeId_month: { employeeId: emp, month: lastMonth } } });
    expect(Number(m.leave)).toBe(2);
    expect(Number(m.noPayLeave)).toBe(1);
    expect(Number(m.payableDays)).toBe(m.daysOnRoll - 1);
  });
});
