import { describe, expect, it } from "vitest";
import { istInstant } from "@/lib/dates";
import type { DayStatus } from "@/generated/prisma/enums";
import { calendarDay, monthTotals, resolveDay, statusFromPunches, weeklyOffFor, type AttendanceRules, type DayInput, type ResolvedDay } from "@/modules/attendance/rules";

const rules: AttendanceRules = { officeStart: "09:00", graceMinutes: 15, halfDayMinutes: 240, weeklyOff: [0, 6] };
const at = (time: string, date = "2026-10-07") => istInstant(date, time);

describe("daily status from punches (AT-03)", () => {
  it("is present within the grace time and late after it", () => {
    expect(statusFromPunches([at("09:15"), at("17:40")], rules)?.status).toBe("PRESENT");
    expect(statusFromPunches([at("09:16"), at("17:40")], rules)?.status).toBe("LATE");
  });

  it("uses the first and last punch whatever the order, and counts the minutes between", () => {
    const d = statusFromPunches([at("13:00"), at("17:30"), at("08:55")], rules)!;
    expect(d.status).toBe("PRESENT");
    expect(d.workedMinutes).toBe(8 * 60 + 35);
  });

  it("is a half day below the half-day time and a missed punch with one punch", () => {
    expect(statusFromPunches([at("09:00"), at("12:59")], rules)?.status).toBe("HALF_DAY");
    expect(statusFromPunches([at("09:00")], rules)?.status).toBe("MISSED_PUNCH");
    expect(statusFromPunches([at("09:00"), at("09:00")], rules)?.status).toBe("MISSED_PUNCH");
    expect(statusFromPunches([], rules)).toBeNull();
  });
});

describe("resolving a day", () => {
  const base: DayInput = {
    date: "2026-10-07",
    today: "2026-10-26",
    onRollFrom: "2015-01-01",
    onRollTo: null,
    mode: "DEVICE",
    calendar: { holiday: false, weeklyOff: false },
    punches: [],
    rules,
  };

  it("marks a past working day with no punch absent for a device section, unmarked for a muster section", () => {
    expect(resolveDay(base).status).toBe("ABSENT");
    const manual = resolveDay({ ...base, mode: "MANUAL" });
    expect(manual.status).toBeNull();
    expect(manual.unmarked).toBe(true);
  });

  it("lets holidays and weekly offs win over a missing punch, and saved entries win over everything", () => {
    expect(resolveDay({ ...base, calendar: { holiday: true, weeklyOff: false } }).status).toBe("HOLIDAY");
    expect(resolveDay({ ...base, calendar: { holiday: false, weeklyOff: true } }).status).toBe("WEEKLY_OFF");
    expect(resolveDay({ ...base, calendar: { holiday: true, weeklyOff: false }, saved: { status: "ON_DUTY" } }).status).toBe("ON_DUTY");
  });

  it("does not judge today or the future yet", () => {
    expect(resolveDay({ ...base, date: "2026-10-26" }).status).toBeNull();
    expect(resolveDay({ ...base, date: "2026-10-27" }).status).toBeNull();
    // Punched in this morning: present, even though there is no out punch yet.
    expect(resolveDay({ ...base, date: "2026-10-26", punches: [at("09:05", "2026-10-26")] }).status).toBe("PRESENT");
    expect(resolveDay({ ...base, date: "2026-10-26", punches: [at("09:40", "2026-10-26")] }).status).toBe("LATE");
  });

  it("leaves days before joining or after leaving off the rolls", () => {
    const d = resolveDay({ ...base, onRollFrom: "2026-10-10" });
    expect(d.onRoll).toBe(false);
    expect(d.status).toBeNull();
    expect(resolveDay({ ...base, onRollTo: "2026-10-06" }).onRoll).toBe(false);
  });

  it("knows the calendar and section weekly off", () => {
    expect(calendarDay("2026-10-02", new Set(["2026-10-02"]), [0, 6])).toEqual({ holiday: true, weeklyOff: false });
    expect(calendarDay("2026-10-04", new Set(), [0, 6]).weeklyOff).toBe(true); // Sunday
    expect(weeklyOffFor(null, [0, 6])).toEqual([0, 6]);
    expect(weeklyOffFor("0", [0, 6])).toEqual([0]);
    expect(weeklyOffFor("-", [0, 6])).toEqual([]);
  });
});

describe("month totals (AT-05, AT-06)", () => {
  const day = (status: DayStatus, half = false): ResolvedDay => ({ status, onRoll: true, unmarked: false, from: "saved", firstIn: null, lastOut: null, workedMinutes: null, half, checked: true });

  it("pays days on the rolls less dies-non, and counts days worked for wage workers", () => {
    const t = monthTotals([
      day("PRESENT"),
      day("LATE"),
      day("HALF_DAY"),
      day("ON_DUTY"),
      day("HOLIDAY"),
      day("WEEKLY_OFF"),
      day("DIES_NON"),
      day("DIES_NON", true),
      { ...day("PRESENT"), onRoll: false, status: null },
    ]);
    expect(t.daysInMonth).toBe(9);
    expect(t.daysOnRoll).toBe(8);
    expect(t.present).toBe(3); // 1 + 1 (late) + ½ (half day) + ½ (worked half of the half dies-non)
    expect(t.late).toBe(1);
    expect(t.diesNon).toBe(1.5);
    expect(t.payableDays).toBe(6.5);
    expect(t.workedDays).toBe(4); // present 3 + on duty 1
  });
});
