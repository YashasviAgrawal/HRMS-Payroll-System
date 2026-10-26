import { beforeAll, describe, expect, it } from "vitest";
import { cancelTask, decide } from "@/lib/approvals/engine";
import { db } from "@/lib/db";
import { addDays, datesOfMonth, monthOf, shiftMonth, todayIST, weekday } from "@/lib/dates";
import { listHolidays, submitHolidayList } from "@/modules/attendance/holidays";
import { checkPunchFile, devicePush, savePunchFile } from "@/modules/attendance/imports";
import { lockDue, lockMonth, lockOf, lockPreview, requestUnlock, sectionRegister, submitAttendanceRequest, submitMuster, todayBoard } from "@/modules/attendance/service";
import { actorFor, hasTestDb, makeBoard, makeEmployee, makePost, makeSection, makeUser } from "../support/factory";

type Actor = Awaited<ReturnType<typeof actorFor>>;

const dmy = (iso: string) => iso.split("-").reverse().join("-");

describe("lock due date (D-17)", () => {
  it("is last month, due on the lock day of this month", () => {
    expect(lockDue("2026-10-26", 25)).toEqual({ month: "2026-09", due: "2026-10-25", overdue: true });
    expect(lockDue("2026-10-25", 25).overdue).toBe(false);
    expect(lockDue("2026-01-10", 25).month).toBe("2025-12");
  });
});

describe.skipIf(!hasTestDb)("attendance (AT-01…AT-08)", () => {
  let boardId: string;
  let device: string;
  let manual: string;
  let e1: string;
  let e2: string;
  let e3: string;
  let hr: Actor;
  let checker: Actor;
  let officer: Actor;
  let staff2: Actor;
  const today = todayIST();
  const lastMonth = shiftMonth(monthOf(today), -1);
  const working = datesOfMonth(lastMonth).filter((d) => weekday(d) >= 1 && weekday(d) <= 5);
  const [d1, d2] = [working[2], working[3]];

  beforeAll(async () => {
    boardId = (await makeBoard()).id;
    device = (await makeSection(boardId)).id;
    manual = (await db.section.update({ where: { id: (await makeSection(boardId)).id }, data: { attendanceMode: "MANUAL" } })).id;
    const postId = (await makePost(boardId)).id;
    e1 = (await makeEmployee(boardId, { sectionId: device, postId })).id;
    e2 = (await makeEmployee(boardId, { sectionId: device, postId })).id;
    e3 = (await makeEmployee(boardId, { sectionId: manual, postId })).id;
    const head = (await makeEmployee(boardId, { sectionId: device, postId })).id;
    const tag = Date.now().toString(36).toUpperCase();
    await db.employee.update({ where: { id: e1 }, data: { biometricId: `A${tag}` } });
    await db.employee.update({ where: { id: e2 }, data: { biometricId: `B${tag}` } });
    hr = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["HR"])).id);
    checker = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["CHECKER"])).id);
    officer = await actorFor((await makeUser(boardId, "EMPLOYEE", ["REPORTING_OFFICER"], head)).id);
    staff2 = await actorFor((await makeUser(boardId, "EMPLOYEE", [], e2)).id);
  });

  const bio = async (id: string) => (await db.employee.findUniqueOrThrow({ where: { id } })).biometricId!;
  const approve = async (entityId: string, who: Actor) => {
    const t = await db.approvalTask.findFirstOrThrow({ where: { entityId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
    return decide(who, t.id, "APPROVE");
  };
  const dayOf = async (actor: Actor, section: string, employeeId: string, date: string) => {
    const reg = await sectionRegister(actor, section, monthOf(date));
    return reg.rows.find((r) => r.employee.id === employeeId)!.days.find((d) => d.date === date)!;
  };

  it("checks a punch file before saving, then saves only new punches (AT-01)", async () => {
    const [b1, b2] = [await bio(e1), await bio(e2)];
    const csv = [
      "Biometric ID,Date,Time",
      `${b1},${dmy(d1)},09:02`,
      `${b1},${dmy(d1)},17:45`,
      `${b2},${dmy(d1)},09:30`,
      `ZZ999,${dmy(d1)},09:00`,
      `${b1},${dmy(addDays(today, 2))},09:00`,
      `${b1},someday,09:00`,
      `${b1},${dmy(d1)},09:02`,
    ].join("\n");
    const file = Buffer.from(csv);
    const check = await checkPunchFile(hr, file, "punches.csv", "TEMPLATE");
    expect(check).toMatchObject({ ready: 3, duplicatesInFile: 1, future: 1, errorCount: 1, unknownIds: [{ id: "ZZ999", count: 1 }], people: 2 });
    expect(await db.attendancePunch.count({ where: { employeeId: { in: [e1, e2] } } })).toBe(0);

    await expect(checkPunchFile(staff2, file, "punches.csv", "TEMPLATE")).rejects.toMatchObject({ status: 403 });
    const saved = await savePunchFile(hr, file, "punches.csv", "TEMPLATE");
    expect(saved.ready).toBe(3);
    await expect(savePunchFile(hr, file, "punches.csv", "TEMPLATE")).rejects.toMatchObject({ key: "attendance.import.nothingNew" });
    const record = await db.attendanceImport.findUniqueOrThrow({ where: { id: saved.importId } });
    expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);

    expect((await dayOf(hr, device, e1, d1)).status).toBe("PRESENT");
    expect((await dayOf(hr, device, e2, d1)).status).toBe("MISSED_PUNCH");
    expect((await dayOf(hr, device, e1, d2)).status).toBe("ABSENT");
  });

  it("sends a missed-punch request to the section's reporting officer, who regularises the day (AT-04)", async () => {
    await expect(submitAttendanceRequest(staff2, { date: addDays(today, 1), type: "ON_DUTY", reason: "Tomorrow's duty" })).rejects.toMatchObject({ key: "attendance.errors.future" });
    await expect(submitAttendanceRequest(staff2, { date: d1, type: "MISSED_PUNCH", reason: "Forgot" })).rejects.toThrow();
    const r = await submitAttendanceRequest(staff2, { date: d1, type: "MISSED_PUNCH", outTime: "17:30", reason: "Forgot to punch out" });
    await expect(submitAttendanceRequest(staff2, { date: d1, type: "ON_DUTY", reason: "Again" })).rejects.toMatchObject({ key: "attendance.errors.requestPending" });
    const task = await db.approvalTask.findFirstOrThrow({ where: { entityId: r.id } });
    expect(task).toMatchObject({ requiredPermission: "REPORTING_OFFICER", sectionId: device, subjectEmployeeId: e2 });
    await expect(decide(checker, task.id, "APPROVE")).rejects.toMatchObject({ status: 403 });
    await decide(officer, task.id, "APPROVE");
    const day = await dayOf(officer, device, e2, d1);
    expect(day.status).toBe("LATE"); // in at 09:30 (device), out at 17:30 (request)
    expect((await db.attendanceRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("APPROVED");

    // The officer's own request goes to HR, not to themself.
    const own = await submitAttendanceRequest(officer, { date: d1, type: "ON_DUTY", reason: "Inspection round" });
    expect((await db.approvalTask.findFirstOrThrow({ where: { entityId: own.id } })).requiredPermission).toBe("HR");
    await approve(own.id, hr);
  });

  it("keeps sections apart: an officer sees only their section, an employee sees no register", async () => {
    await expect(sectionRegister(officer, manual, lastMonth)).rejects.toMatchObject({ status: 403 });
    await expect(sectionRegister(staff2, device, lastMonth)).rejects.toMatchObject({ status: 403 });
    const board = await todayBoard(officer);
    expect(board.sections.map((s) => s.section.id)).toEqual([device]);
  });

  it("puts muster entries through a Checker before they count (AT-02)", async () => {
    const entries = datesOfMonth(lastMonth)
      .filter((d) => weekday(d) >= 1 && weekday(d) <= 5)
      .map((date, i) => ({ employeeId: e3, date, status: i === 0 ? ("ON_DUTY" as const) : ("PRESENT" as const) }));
    await expect(submitMuster(hr, { sectionId: manual, month: monthOf(today), entries: [{ employeeId: e3, date: addDays(today, 1), status: "PRESENT" }] })).rejects.toThrow();
    await expect(submitMuster(officer, { sectionId: manual, month: lastMonth, entries })).rejects.toMatchObject({ status: 403 });
    await submitMuster(hr, { sectionId: manual, month: lastMonth, entries });
    await expect(submitMuster(hr, { sectionId: manual, month: lastMonth, entries })).rejects.toMatchObject({ key: "attendance.errors.musterPending" });
    const before = await dayOf(hr, manual, e3, entries[1].date);
    expect(before.status).toBeNull();
    expect(before.pending).toBe("PRESENT");
    expect((await lockPreview(hr, manual, lastMonth)).blockers.pendingMuster).toBe(true);
    await approve(`${manual}:${lastMonth}`, checker);
    expect((await dayOf(hr, manual, e3, entries[0].date)).status).toBe("ON_DUTY");
    expect((await dayOf(hr, manual, e3, entries[1].date)).status).toBe("PRESENT");
  });

  it("locks a month only when every unexplained day is decided, and freezes the totals (AT-05)", async () => {
    // An open request blocks the lock.
    const open = await submitAttendanceRequest(staff2, { date: d2, type: "ON_DUTY", reason: "Court duty" });
    await expect(lockMonth(officer, { sectionId: device, month: lastMonth, resolutions: [] })).rejects.toMatchObject({ key: "attendance.errors.requestsOpen" });
    await cancelTask(staff2, open.taskId ?? (await db.attendanceRequest.findUniqueOrThrow({ where: { id: open.id } })).taskId!);

    const preview = await lockPreview(officer, device, lastMonth);
    expect(preview.blockers).toMatchObject({ monthNotOver: false, pendingRequests: 0, pendingMuster: false, unmarked: 0 });
    const exceptions = preview.exceptions;
    expect(exceptions.length).toBeGreaterThan(0);
    expect(exceptions.every((x) => ["ABSENT", "MISSED_PUNCH", "HALF_DAY"].includes(x.status))).toBe(true);
    await expect(lockMonth(officer, { sectionId: device, month: lastMonth, resolutions: exceptions.slice(1).map((x) => ({ employeeId: x.employeeId, date: x.date, outcome: "DIES_NON" })) })).rejects.toMatchObject({
      key: "attendance.errors.undecided",
    });
    await expect(lockMonth(staff2, { sectionId: device, month: lastMonth, resolutions: [] })).rejects.toMatchObject({ status: 403 });

    const resolutions = exceptions.map((x) => ({ employeeId: x.employeeId, date: x.date, outcome: x.employeeId === e1 ? ("PRESENT" as const) : ("DIES_NON" as const) }));
    await lockMonth(officer, { sectionId: device, month: lastMonth, resolutions });
    expect(await lockOf(boardId, device, lastMonth)).not.toBeNull();

    const m1 = await db.attendanceMonth.findUniqueOrThrow({ where: { employeeId_month: { employeeId: e1, month: lastMonth } } });
    expect(Number(m1.diesNon)).toBe(0);
    expect(Number(m1.payableDays)).toBe(m1.daysOnRoll);
    const m2 = await db.attendanceMonth.findUniqueOrThrow({ where: { employeeId_month: { employeeId: e2, month: lastMonth } } });
    const e2DiesNon = resolutions.filter((r) => r.employeeId === e2).length;
    expect(Number(m2.diesNon)).toBe(e2DiesNon);
    expect(Number(m2.payableDays)).toBe(m2.daysOnRoll - e2DiesNon);
    expect(await db.attendanceDay.count({ where: { employeeId: e2, date: { gte: new Date(`${lastMonth}-01T00:00:00Z`) }, status: "DIES_NON" } })).toBe(e2DiesNon);

    // Locked means locked: no muster, no requests, no punches.
    await expect(submitMuster(hr, { sectionId: device, month: lastMonth, entries: [{ employeeId: e1, date: d2, status: "PRESENT" }] })).rejects.toMatchObject({ key: "attendance.errors.locked" });
    await expect(submitAttendanceRequest(staff2, { date: d2, type: "ON_DUTY", reason: "Late request" })).rejects.toMatchObject({ key: "attendance.errors.locked" });
    const late = await checkPunchFile(hr, Buffer.from(`Biometric ID,Date,Time\n${await bio(e1)},${dmy(d2)},09:00`), "late.csv", "TEMPLATE");
    expect(late).toMatchObject({ ready: 0, locked: 1 });
    await expect(lockMonth(officer, { sectionId: device, month: lastMonth, resolutions: [] })).rejects.toMatchObject({ key: "attendance.errors.alreadyLocked" });

    // Reopening: HR asks, a Checker decides; the officer cannot ask.
    await expect(requestUnlock(officer, { sectionId: device, month: lastMonth, reason: "Wrong decision for one day" })).rejects.toMatchObject({ status: 403 });
    const task = await requestUnlock(hr, { sectionId: device, month: lastMonth, reason: "Wrong decision for one day" });
    await decide(checker, task.id, "APPROVE");
    expect(await lockOf(boardId, device, lastMonth)).toBeNull();
    expect(await db.attendanceMonth.count({ where: { sectionId: device, month: lastMonth } })).toBe(0);
  });

  it("checks the holiday calendar and protects locked months (AT-08)", async () => {
    const next = Number(today.slice(0, 4)) + 1;
    await submitHolidayList(hr, {
      year: next,
      holidays: [
        { date: `${next}-01-26`, name: "Republic Day", nameHi: "गणतंत्र दिवस", kind: "GAZETTED" },
        { date: `${next}-01-14`, name: "Makar Sankranti", nameHi: "मकर संक्रांति", kind: "RESTRICTED" },
      ],
    });
    await expect(submitHolidayList(hr, { year: next, holidays: [] })).rejects.toMatchObject({ key: "attendance.errors.calendarPending" });
    expect((await listHolidays(hr, next)).holidays).toHaveLength(0);
    await approve(String(next), checker);
    expect((await listHolidays(staff2, next)).holidays.map((h) => h.name)).toEqual(["Makar Sankranti", "Republic Day"]);
    await expect(submitHolidayList(hr, { year: next, holidays: [{ date: `${next + 1}-01-01`, name: "Wrong year", nameHi: "गलत", kind: "GAZETTED" }] })).rejects.toThrow();

    // Lock the muster section's month, then try to add a gazetted holiday inside it.
    await lockMonth(hr, { sectionId: manual, month: lastMonth, resolutions: [] });
    const year = Number(lastMonth.slice(0, 4));
    const current = (await listHolidays(hr, year)).holidays.map(({ date, name, nameHi, kind }) => ({ date, name, nameHi, kind }));
    await expect(submitHolidayList(hr, { year, holidays: [...current, { date: d2, name: "Sudden holiday", nameHi: "अचानक अवकाश", kind: "GAZETTED" as const }] })).rejects.toMatchObject({
      key: "attendance.errors.holidayInLockedMonth",
    });
  });

  it("accepts punches pushed by a registered device only (AT-01 device sync)", async () => {
    await db.setting.upsert({
      where: { boardId_key: { boardId, key: "attendance" } },
      create: { boardId, key: "attendance", value: { officeStart: "09:00", graceMinutes: 15, halfDayMinutes: 240, weeklyOff: [0, 6], devices: [{ serial: "TESTSN1", name: "Gate" }] } },
      update: { value: { officeStart: "09:00", graceMinutes: 15, halfDayMinutes: 240, weeklyOff: [0, 6], devices: [{ serial: "TESTSN1", name: "Gate" }] } },
    });
    const line = `${await bio(e1)}\t${today} 00:01:00\t0\t1\t0`;
    expect(await devicePush(boardId, "UNKNOWN", line, null)).toMatchObject({ accepted: false, saved: 0 });
    expect(await devicePush(boardId, "TESTSN1", line, "10.0.0.5")).toMatchObject({ accepted: true, saved: 1, received: 1 });
    expect(await devicePush(boardId, "TESTSN1", line, "10.0.0.5")).toMatchObject({ accepted: true, saved: 0 });
    expect(await db.attendancePunch.count({ where: { employeeId: e1, deviceSerial: "TESTSN1" } })).toBe(1);
    await db.setting.delete({ where: { boardId_key: { boardId, key: "attendance" } } });
  });
});
