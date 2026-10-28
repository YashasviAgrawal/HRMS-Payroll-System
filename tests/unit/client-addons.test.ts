import { describe, expect, it } from "vitest";
import { combineParts, monthParts } from "@/modules/payroll/arrear-days";
import { daTaHistory } from "@/modules/payroll/da-history";
import type { PayLine } from "@/modules/payroll/engine";

const line = (code: string, amount: number): PayLine => ({ code, name: code, nameHi: code, kind: "EARNING", amount, accountHead: "" });

describe("arrears by days (PR-08)", () => {
  it("keeps a month whole when every change falls on the 1st", () => {
    expect(monthParts("2026-04", ["2026-04-01", "2026-01-01"])).toEqual([{ from: "2026-04-01", to: "2026-04-30", days: 30 }]);
  });

  it("splits a month at a change in the middle, and ignores changes in other months", () => {
    expect(monthParts("2026-04", ["2026-04-15", "2026-05-10", "2026-03-20", "2026-04-15"])).toEqual([
      { from: "2026-04-01", to: "2026-04-14", days: 14 },
      { from: "2026-04-15", to: "2026-04-30", days: 16 },
    ]);
    expect(monthParts("2024-02", ["2024-02-10", "2024-02-20"]).map((p) => p.days)).toEqual([9, 10, 10]);
  });

  it("pays each part for its own days, head by head, rounded to the rupee", () => {
    // Basic ₹35,400 → ₹36,500 from 15 April: 14/30 × 35,400 + 16/30 × 36,500 = 16,520 + 19,466.67 → ₹35,987.
    const lines = combineParts(
      [
        { lines: [line("BASIC", 35400), line("DA", 21240)], days: 14 },
        { lines: [line("BASIC", 36500), line("DA", 21900)], days: 16 },
      ],
      30,
    );
    expect(lines.find((l) => l.code === "BASIC")!.amount).toBe(35987);
    expect(lines.find((l) => l.code === "DA")!.amount).toBe(21592);
  });

  it("gives back one part unchanged", () => {
    const one = [line("BASIC", 35400)];
    expect(combineParts([{ lines: one, days: 30 }], 30)).toBe(one);
  });
});

describe("DA and TA by year", () => {
  const rates = [
    { key: "DA_PERCENT", value: 0, effectiveFrom: "2016-01-01", note: "7th CPC" },
    { key: "TA_HIGH", value: 7200, effectiveFrom: "2016-01-01", note: null },
    { key: "TA_MID", value: 3600, effectiveFrom: "2016-01-01", note: null },
    { key: "TA_LOW", value: 1350, effectiveFrom: "2016-01-01", note: null },
    { key: "DA_PERCENT", value: 2, effectiveFrom: "2016-07-01", note: "DA order" },
    { key: "DA_PERCENT", value: 4, effectiveFrom: "2017-01-01", note: "DA order" },
    { key: "DA_PERCENT", value: 58, effectiveFrom: "2025-07-01", note: "DA order" },
    { key: "DA_PERCENT", value: 60, effectiveFrom: "2026-01-01", note: "DA order" },
    { key: "HRA_PERCENT", value: 30, effectiveFrom: "2024-01-01", note: null },
  ];

  it("lists each order newest first, grouped by year, with the step and DA on TA", () => {
    const years = daTaHistory(rates, "2026-10-28");
    expect(years.map((y) => y.year)).toEqual(["2026", "2025", "2017", "2016"]);
    const y2016 = years.find((y) => y.year === "2016")!;
    expect(y2016.rows.map((r) => r.from)).toEqual(["2016-07-01", "2016-01-01"]);
    expect(y2016.rows[0]).toMatchObject({ da: 2, daStep: 2, daOnTa: { HIGH: 144, MID: 72, LOW: 27 }, taTotal: { HIGH: 7344, MID: 3672, LOW: 1377 } });
    expect(y2016.rows[1]).toMatchObject({ daStep: null, changed: ["DA", "TA"] });
    const y2026 = years[0];
    expect(y2026).toMatchObject({ daStart: 58, daEnd: 60 });
    expect(y2026.rows[0]).toMatchObject({ da: 60, daStep: 2, daOnTa: { HIGH: 4320, MID: 2160, LOW: 810 }, upcoming: false });
    expect(years[1].rows[0].daStep).toBe(54);
  });

  it("marks an order dated after today as coming", () => {
    const years = daTaHistory([...rates, { key: "DA_PERCENT", value: 64, effectiveFrom: "2027-01-01", note: null }], "2026-10-28");
    expect(years[0].rows[0]).toMatchObject({ from: "2027-01-01", da: 64, daStep: 4, upcoming: true });
  });
});
