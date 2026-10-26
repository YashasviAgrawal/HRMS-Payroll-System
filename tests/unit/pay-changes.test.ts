import { describe, expect, it } from "vitest";
import { loanPosition, loanSchedule } from "@/modules/payroll/loan-rules";
import { seventhCpcMatrix } from "@/modules/payroll/matrix-7cpc";
import { cellAtOrAbove, fixPay, incrementDatesAround, incrementMonthFor, nextIncrementDate, qualifies } from "@/modules/payroll/pay-rules";

const levels = seventhCpcMatrix();

describe("PR-06 increment dates", () => {
  it("gives 1 January for 2 January to 1 July, and 1 July otherwise", () => {
    expect(incrementMonthFor("2010-01-02")).toBe(1);
    expect(incrementMonthFor("2010-07-01")).toBe(1);
    expect(incrementMonthFor("2010-07-02")).toBe(7);
    expect(incrementMonthFor("2010-01-01")).toBe(7);
    expect(incrementMonthFor("2024-11-18")).toBe(7);
  });

  it("finds the next and the last increment dates", () => {
    expect(nextIncrementDate("2026-10-26", 1)).toBe("2027-01-01");
    expect(nextIncrementDate("2026-03-01", 7)).toBe("2026-07-01");
    expect(nextIncrementDate("2026-07-01", 7)).toBe("2027-07-01");
    expect(incrementDatesAround("2026-10-26")).toEqual({ last: "2026-07-01", next: "2027-01-01" });
    expect(incrementDatesAround("2026-03-15")).toEqual({ last: "2026-01-01", next: "2026-07-01" });
  });

  it("needs six months in the level on the due date", () => {
    expect(qualifies("2026-03-01", "2026-07-01")).toBe(false);
    expect(qualifies("2026-01-01", "2026-07-01")).toBe(true);
  });
});

describe("PR-07 pay fixation", () => {
  it("places at the equal or next higher cell, or the last one", () => {
    expect(cellAtOrAbove(levels["8"], 52000)).toBe(4);
    expect(cellAtOrAbove(levels["8"], 51000)).toBe(4);
    expect(cellAtOrAbove(levels["17"], 999999)).toBe(1);
  });

  it("from the promotion date: one increment in the old level, then the cell in the new one", () => {
    // Level 7 cell 5 = ₹50,500; one increment = cell 6 ₹52,000; Level 8 has ₹52,000 at cell 4.
    const f = fixPay(levels, { fromLevel: "7", fromCell: 5, toLevel: "8", date: "2026-08-10", option: "FROM_PROMOTION", incrementMonth: 1 })!;
    expect(f.steps).toHaveLength(1);
    expect(f.steps[0]).toMatchObject({ date: "2026-08-10", level: "8", cell: 4, basic: 52000, from: { basic: 50500, notional: 52000 } });
    expect(f.incrementMonth).toBe(7);
  });

  it("from the next increment date: equal cell now, re-fixed with two increments on that date", () => {
    const f = fixPay(levels, { fromLevel: "7", fromCell: 5, toLevel: "8", date: "2026-08-10", option: "FROM_NEXT_INCREMENT", incrementMonth: 1 })!;
    expect(f.steps.map((s) => [s.date, s.cell, s.basic])).toEqual([
      ["2026-08-10", 3, 50500],
      ["2027-01-01", 5, 53600],
    ]);
    expect(f.incrementMonth).toBe(1);
  });

  it("refuses a level or cell that is not in the matrix", () => {
    expect(fixPay(levels, { fromLevel: "7", fromCell: 99, toLevel: "8", date: "2026-08-10", option: "FROM_PROMOTION", incrementMonth: 1 })).toBeNull();
    expect(fixPay(levels, { fromLevel: "7", fromCell: 1, toLevel: "99", date: "2026-08-10", option: "FROM_PROMOTION", incrementMonth: 1 })).toBeNull();
  });
});

describe("PR-09 loans", () => {
  it("recovers an interest-free advance in equal instalments and stops at zero", () => {
    const s = loanSchedule({ principal: 10000, interestRate: 0, instalmentAmount: 1000, startMonth: "2026-08" });
    expect(s).toHaveLength(10);
    expect(s.at(-1)).toMatchObject({ month: "2027-05", principal: 1000, principalLeft: 0 });
    expect(s.every((r) => r.interest === 0)).toBe(true);
  });

  it("recovers the principal first, then the simple interest on the reducing balance", () => {
    const s = loanSchedule({ principal: 12000, interestRate: 10, instalmentAmount: 1000, startMonth: "2026-01" });
    expect(s.filter((r) => r.principal > 0)).toHaveLength(12);
    // 10% a year on 12,000 → 11,000 → … → 1,000, a month each: ₹650.
    expect(s.filter((r) => r.interest > 0).map((r) => r.interest)).toEqual([650]);
    expect(s.at(-1)!.month).toBe("2027-01");
  });

  it("takes a smaller last instalment and keeps charging interest in a month nothing was recovered", () => {
    const terms = { principal: 2500, interestRate: 12, instalmentAmount: 1000, startMonth: "2026-01" };
    expect(loanSchedule({ ...terms, interestRate: 0 }).map((r) => r.principal)).toEqual([1000, 1000, 500]);
    // January recovered, February missed: interest runs on 1,500 in February and March.
    const pos = loanPosition(terms, [{ month: "2026-01", principal: 1000, interest: 0 }], "2026-03");
    expect(pos.principalLeft).toBe(1500);
    expect(pos.due).toEqual({ principal: 1000, interest: 0 });
    const done = loanPosition(terms, [{ month: "2026-01", principal: 1000, interest: 0 }, { month: "2026-03", principal: 1000, interest: 0 }, { month: "2026-04", principal: 500, interest: 0 }, { month: "2026-05", principal: 0, interest: 60 }], "2026-06");
    expect(done.closed).toBe(true);
    // 1% a month on 2,500, 1,500, 1,500 and 500.
    expect(done.interestTotal).toBe(60);
  });
});
