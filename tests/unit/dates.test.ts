import { describe, expect, it } from "vitest";
import { addMonths, completedYears, daysBetweenInclusive, endOfMonth, financialYear, formatDate, retirementDate, todayIST } from "@/lib/dates";

describe("retirement date (EM-02, FR 56)", () => {
  it("is the last day of the month in which the employee turns 60", () => {
    expect(retirementDate("1990-05-05")).toBe("2050-05-31");
    expect(retirementDate("1966-11-20")).toBe("2026-11-30");
    expect(retirementDate("1966-12-31")).toBe("2026-12-31");
  });

  it("someone born on the 1st retires at the end of the previous month", () => {
    expect(retirementDate("1968-01-01")).toBe("2027-12-31");
    expect(retirementDate("1966-03-01")).toBe("2026-02-28");
    expect(retirementDate("1964-03-01")).toBe("2024-02-29");
  });

  it("handles 29 February births", () => {
    expect(retirementDate("1964-02-29")).toBe("2024-02-29");
    expect(retirementDate("1963-02-28")).toBe("2023-02-28");
  });

  it("follows the post's own retirement age", () => {
    expect(retirementDate("1976-11-30", 62)).toBe("2038-11-30");
  });
});

describe("date helpers", () => {
  it("counts days inclusively", () => {
    expect(daysBetweenInclusive("2026-01-01", "2026-01-31")).toBe(31);
    expect(daysBetweenInclusive("2026-02-10", "2026-02-10")).toBe(1);
  });

  it("adds months without overflowing short months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("finds month ends, ages and financial years", () => {
    expect(endOfMonth("2026-02-03")).toBe("2026-02-28");
    expect(completedYears("1990-05-05", "2026-05-04")).toBe(35);
    expect(completedYears("1990-05-05", "2026-05-05")).toBe(36);
    expect(financialYear("2026-03-31")).toBe("2025-26");
    expect(financialYear("2026-04-01")).toBe("2026-27");
  });

  it("uses India time for today", () => {
    // 20:00 UTC on 31 Dec is already 1 Jan in India.
    expect(todayIST(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
  });

  it("formats dates in English and Hindi", () => {
    expect(formatDate("2026-10-26")).toBe("26 Oct 2026");
    expect(formatDate("2026-10-26", "hi")).toBe("26 अक्टूबर 2026");
  });
});
