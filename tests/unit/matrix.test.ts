import { describe, expect, it } from "vitest";
import { crossCheck } from "@/modules/employees/schema";
import { basicIn, basicPay, levelsOf, seventhCpcMatrix } from "@/modules/payroll/matrix-7cpc";

describe("7th CPC pay matrix (PR-01)", () => {
  const m = seventhCpcMatrix();

  it("matches the official maximum of every level", () => {
    const officialMax: Record<string, number> = {
      "1": 56900, "2": 63200, "3": 69100, "4": 81100, "5": 92300, "6": 112400, "7": 142400, "8": 151100,
      "9": 167800, "10": 177500, "11": 208700, "12": 209200, "13": 215900, "13A": 216600, "14": 218200,
      "15": 224100, "16": 224400, "17": 225000, "18": 250000,
    };
    for (const [level, max] of Object.entries(officialMax)) expect(m[level].at(-1), `level ${level}`).toBe(max);
  });

  it("matches well-known cells", () => {
    expect(basicPay("6", 1)).toBe(35400); // PRD worked example
    expect(basicPay("6", 2)).toBe(36500);
    expect(basicPay("1", 2)).toBe(18500);
    expect(basicPay("7", 5)).toBe(50500);
    expect(basicPay("10", 3)).toBe(59500);
    expect(basicPay("6", 41)).toBeNull();
    expect(basicPay(null, 1)).toBeNull();
  });
});

describe("a newer dated matrix (PR-01) drives the screens", () => {
  // A made-up 8th CPC style table: a new level and fewer cells.
  const eighth = { "1": [34000, 35000], "6": [66800, 68800, 70900], "13A": [240000], "19": [300000] };
  const job = (payLevel: string, payCell: number) => ({ type: "PERMANENT_NPS" as const, sectionId: "s", postId: "p", dateOfJoining: "2028-01-01", payLevel, payCell });

  it("reads Basic, levels and cells from the matrix it is given", () => {
    expect(basicIn(eighth, "6", 3)).toBe(70900);
    expect(basicIn(eighth, "6", 4)).toBeNull();
    expect(levelsOf(eighth)).toEqual(["1", "6", "13A", "19"]);
  });

  it("accepts a level that only the new matrix has and refuses a cell it does not have", () => {
    const person = { dateOfBirth: "1990-01-01" };
    expect(crossCheck(person, job("19", 1) as never, undefined, eighth)).toEqual({});
    expect(crossCheck(person, job("6", 4) as never, undefined, eighth)).toEqual({ "job.payCell": "employees.errors.noSuchCell" });
    expect(crossCheck(person, job("7", 1) as never, undefined, eighth)).toEqual({ "job.payLevel": "validation.invalid" });
    // Before any matrix is stored the built-in 7th CPC table applies.
    expect(crossCheck(person, job("6", 40) as never)).toEqual({});
    expect(crossCheck(person, job("6", 41) as never)).toEqual({ "job.payCell": "employees.errors.noSuchCell" });
  });
});
