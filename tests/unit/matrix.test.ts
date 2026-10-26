import { describe, expect, it } from "vitest";
import { basicPay, seventhCpcMatrix } from "@/modules/payroll/matrix-7cpc";

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
