import { describe, expect, it } from "vitest";
import { cappedCredit, countLeaveDays, creditPeriod, deciderFor, isEligible, leaveDates, periodCredit } from "@/modules/leave/rules";

const cal = { holidays: new Set(["2026-10-02"]), weeklyOff: [0, 6] };

describe("counting leave days (PRD §7)", () => {
  it("skips weekends and holidays inside CL but counts every day of EL", () => {
    // Thu 1 Oct – Tue 6 Oct 2026: Fri 2 Oct is a holiday, 3–4 Oct the weekend.
    expect(countLeaveDays({ from: "2026-10-01", to: "2026-10-06", halfDay: false, countsOffDays: false, ...cal })).toBe(3);
    expect(countLeaveDays({ from: "2026-10-01", to: "2026-10-06", halfDay: false, countsOffDays: true, ...cal })).toBe(6);
    expect(leaveDates({ from: "2026-10-01", to: "2026-10-06", countsOffDays: false, ...cal })).toEqual(["2026-10-01", "2026-10-05", "2026-10-06"]);
  });

  it("allows half a working day, never half a holiday", () => {
    expect(countLeaveDays({ from: "2026-10-05", to: "2026-10-05", halfDay: true, countsOffDays: false, ...cal })).toBe(0.5);
    expect(countLeaveDays({ from: "2026-10-02", to: "2026-10-02", halfDay: true, countsOffDays: false, ...cal })).toBe(0);
    expect(countLeaveDays({ from: "2026-10-06", to: "2026-10-05", halfDay: false, countsOffDays: true, ...cal })).toBe(0);
  });
});

describe("credits (LV-02)", () => {
  const el = { creditMode: "HALF_YEARLY" as const, creditDays: 15, restrictedOnly: false };
  const cl = { creditMode: "YEARLY" as const, creditDays: 8, restrictedOnly: false };

  it("knows the half-year and year a date falls in", () => {
    expect(creditPeriod("HALF_YEARLY", "2026-10-26")).toEqual({ id: "2026-H2", start: "2026-07-01", end: "2026-12-31" });
    expect(creditPeriod("HALF_YEARLY", "2026-03-01").id).toBe("2026-H1");
    expect(creditPeriod("YEARLY", "2026-03-01")).toEqual({ id: "2026", start: "2026-01-01", end: "2026-12-31" });
  });

  it("gives the full credit to staff on the rolls at the start, and 2½ days a completed month to new joiners", () => {
    const h2 = creditPeriod("HALF_YEARLY", "2026-08-01");
    expect(periodCredit(el, "2015-01-01", h2)).toBe(15);
    expect(periodCredit(el, "2026-09-15", h2)).toBe(8); // Oct, Nov, Dec = 3 × 2½ = 7½ → 8
    expect(periodCredit(el, "2026-09-01", h2)).toBe(10); // joined on the 1st: Sep counts too
    expect(periodCredit(el, "2027-01-05", h2)).toBe(0);
    expect(periodCredit(cl, "2026-07-10", creditPeriod("YEARLY", "2026-07-10"))).toBe(3); // 5 months × 8/12 = 3.3 → 3
    expect(periodCredit({ creditMode: "YEARLY", creditDays: 2, restrictedOnly: true }, "2026-11-20", creditPeriod("YEARLY", "2026-11-20"))).toBe(2);
  });

  it("never credits EL above the cap of 300", () => {
    expect(cappedCredit(15, 290, 300)).toBe(10);
    expect(cappedCredit(15, 300, 300)).toBe(0);
    expect(cappedCredit(15, 100, null)).toBe(15);
  });
});

describe("who may take and who decides", () => {
  it("checks gender and employee type", () => {
    const ml = { gender: "F", employeeTypes: ["PERMANENT_NPS" as const] };
    expect(isEligible(ml, { gender: "F", type: "PERMANENT_NPS" })).toBe(true);
    expect(isEligible(ml, { gender: "M", type: "PERMANENT_NPS" })).toBe(false);
    expect(isEligible(ml, { gender: "F", type: "DAILY_WAGE" })).toBe(false);
  });

  it("sends leave to the officer within their limit, to an Admin beyond it or when there is no officer (PRD §14)", () => {
    expect(deciderFor({ officerLimitDays: 15 }, 15, true)).toBe("REPORTING_OFFICER");
    expect(deciderFor({ officerLimitDays: 15 }, 16, true)).toBe("APPROVER");
    expect(deciderFor({ officerLimitDays: null }, 1, true)).toBe("APPROVER");
    expect(deciderFor({ officerLimitDays: 15 }, 2, false)).toBe("APPROVER");
  });
});
