import { describe, expect, it } from "vitest";
import { fyList, monthsOfFy, parsePeriod, yearList } from "@/modules/employees/period";
import { combineParts, monthParts } from "@/modules/payroll/arrear-days";
import { daTaHistory } from "@/modules/payroll/da-history";
import type { PayLine } from "@/modules/payroll/engine";
import { billLines, elNotEarned, encashableDays, instalmentsLeft, leaveEncashment, paidBeyond, scaleLines, totalsOf, withheldDue, type StatementLine } from "@/modules/payroll/settlement-rules";

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

describe("full and final settlement rules (client add-on)", () => {
  it("pays earned leave by the kind of leaving: half up to 150 days on resignation, up to 300 on termination, none on dismissal", () => {
    expect(encashableDays("RESIGNATION", 105)).toBe(52.5);
    expect(encashableDays("RESIGNATION", 287)).toBe(143.5);
    expect(encashableDays("RESIGNATION", 300)).toBe(150);
    expect(encashableDays("TERMINATION", 320)).toBe(300);
    expect(encashableDays("DISMISSAL", 200)).toBe(0);
    expect(encashableDays("TRANSFER_OUT", 200)).toBe(0);
    expect(leaveEncashment(52.5, 35400, 12)).toEqual({ withDa: 39648, amount: 69384 });
  });

  it("takes back the half-year's credit for months not completed before leaving", () => {
    const h1 = { days: 15, periodStart: "2019-01-01", periodEnd: "2019-06-30", fullCredit: 15 };
    expect(elNotEarned(h1, "2008-01-01", "2019-03-20")).toBe(10); // January and February completed: 5 earned
    expect(elNotEarned(h1, "2008-01-01", "2019-03-31")).toBe(7); // left at the end of March: three months, 7½ earned rounds to 8
    expect(elNotEarned(h1, "2008-01-01", "2019-06-30")).toBe(0);
    expect(elNotEarned(h1, "2008-01-01", "2019-01-10")).toBe(15);
    // Joined during the half-year: the pro-rata credit already given less what was earned after joining.
    expect(elNotEarned({ ...h1, days: 10 }, "2019-02-01", "2019-04-15")).toBe(10 - 5);
  });

  it("recovers pay drawn after the last day, by days, to the rupee", () => {
    expect(paidBeyond({ month: "2019-03", net: 62000, daysOnRoll: 31, daysInMonth: 31 }, "2019-03-20")).toEqual({ days: 11, amount: 22000 });
    expect(paidBeyond({ month: "2019-03", net: 40000, daysOnRoll: 20, daysInMonth: 31 }, "2019-03-20")).toEqual({ days: 0, amount: 0 });
    expect(paidBeyond({ month: "2019-04", net: 60000, daysOnRoll: 30, daysInMonth: 30 }, "2019-03-20")).toEqual({ days: 30, amount: 60000 });
    expect(paidBeyond({ month: "2019-02", net: 60000, daysOnRoll: 28, daysInMonth: 28 }, "2019-03-20").amount).toBe(0);
    expect(paidBeyond({ month: "2019-03", net: 10000, daysOnRoll: 31, daysInMonth: 31 }, "2019-03-30").amount).toBe(323);
  });

  it("takes the instalments of a standing recovery still to come after the month of leaving", () => {
    expect(instalmentsLeft({ amount: 500, fromMonth: "2019-01", toMonth: "2019-08" }, "2019-03")).toEqual({ months: 5, amount: 2500 });
    expect(instalmentsLeft({ amount: 500, fromMonth: "2019-06", toMonth: "2019-08" }, "2019-03")).toEqual({ months: 3, amount: 1500 });
    expect(instalmentsLeft({ amount: 500, fromMonth: "2019-01", toMonth: "2019-03" }, "2019-03").amount).toBe(0);
    expect(instalmentsLeft({ amount: 500, fromMonth: "2019-01", toMonth: null }, "2019-03").amount).toBe(0);
  });

  it("releases withheld pay after its own deductions, leaving the loan instalment to the loan line", () => {
    const lines: PayLine[] = [
      { ...line("BASIC", 35400) },
      { ...line("DA", 4248) },
      { code: "GPF", name: "GPF", nameHi: "GPF", kind: "DEDUCTION", amount: 3000, accountHead: "" },
      { code: "LOAN", name: "Loan", nameHi: "Loan", kind: "DEDUCTION", amount: 1000, accountHead: "" },
      { code: "PENSION_ER", name: "ER", nameHi: "ER", kind: "EMPLOYER", amount: 3965, accountHead: "" },
    ];
    expect(withheldDue(lines)).toBe(36648);
    expect(scaleLines(lines, 10 / 30).map((l) => l.amount)).toEqual([11800, 1416, 1000, 333, 1322]);
  });

  it("builds the settlement bill so its net equals the statement's", () => {
    const heads: Record<string, { name: string; nameHi: string; kind: PayLine["kind"]; accountHead: string }> = {
      LEAVE_ENCASHMENT: { name: "Leave encashment", nameHi: "अवकाश नकदीकरण", kind: "EARNING", accountHead: "E-1.06" },
      OTHER_DUE: { name: "Other dues", nameHi: "अन्य देय", kind: "EARNING", accountHead: "E-1.04" },
      LOAN: { name: "Loan", nameHi: "ऋण", kind: "DEDUCTION", accountHead: "D-2.07" },
      RECOVERY: { name: "Recovery", nameHi: "वसूली", kind: "DEDUCTION", accountHead: "D-2.10" },
      SOCIETY: { name: "Society", nameHi: "समिति", kind: "DEDUCTION", accountHead: "D-2.09" },
    };
    const slipLines: PayLine[] = [line("BASIC", 35400), { code: "GPF", name: "GPF", nameHi: "GPF", kind: "DEDUCTION", amount: 3000, accountHead: "" }, { code: "LOAN", name: "Loan", nameHi: "Loan", kind: "DEDUCTION", amount: 1000, accountHead: "" }];
    const st: StatementLine[] = [
      { key: "withheld:1", kind: "DUE", source: "WITHHELD", label: "", labelHi: "", amount: withheldDue(slipLines), headCode: "OTHER_DUE", slip: { id: "1", month: "2019-04", lines: slipLines, gpfRefunds: [] } },
      { key: "leave", kind: "DUE", source: "LEAVE", label: "", labelHi: "", amount: 69384, headCode: "LEAVE_ENCASHMENT" },
      { key: "manual:0", kind: "DUE", source: "MANUAL", label: "", labelHi: "", amount: 4000, headCode: "OTHER_DUE" },
      { key: "loan:a", kind: "RECOVERY", source: "LOAN", label: "", labelHi: "", amount: 25000, headCode: "LOAN", loan: { loanId: "a", principal: 25000, interest: 0 } },
      { key: "loan:b", kind: "RECOVERY", source: "LOAN", label: "", labelHi: "", amount: 10250.5, headCode: "LOAN", loan: { loanId: "b", principal: 10000, interest: 250.5 } },
      { key: "overpaid:1", kind: "RECOVERY", source: "OVERPAID", label: "", labelHi: "", amount: 22000, headCode: "RECOVERY" },
      { key: "item:1", kind: "RECOVERY", source: "ITEM", label: "", labelHi: "", amount: 1200, headCode: "SOCIETY" },
    ];
    const bill = billLines(st, (c) => heads[c]);
    const sum = (k: string) => bill.filter((l) => l.kind === k).reduce((t, l) => t + Math.round(l.amount * 100), 0) / 100;
    expect(bill.find((l) => l.code === "LOAN")?.amount).toBe(35250.5);
    expect(bill.find((l) => l.code === "OTHER_DUE")?.amount).toBe(4000);
    expect(bill.find((l) => l.code === "GPF")?.amount).toBe(3000);
    expect(sum("EARNING") - sum("DEDUCTION")).toBeCloseTo(totalsOf(st).net, 2);
    expect(totalsOf(st)).toMatchObject({ dues: 32400 + 69384 + 4000, recoveries: 58450.5, payable: 47333.5, toRecover: 0 });
  });
});

describe("one-screen employee view by month or financial year (client add-on)", () => {
  it("lists a financial year's months, April to March, up to the current month", () => {
    expect(monthsOfFy("2026-27")).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(monthsOfFy("2026-27", "2026-10")).toHaveLength(7);
  });

  it("offers the years of the person's service, newest first", () => {
    expect(fyList("2024-02-10", "2026-10-28")).toEqual(["2026-27", "2025-26", "2024-25", "2023-24"]);
    expect(yearList("2024-02-10", "2026-10-28")).toEqual([2026, 2025, 2024]);
  });

  it("reads the period from the address and keeps it within the service and today", () => {
    const opts = { today: "2026-10-28", doj: "2012-03-01" };
    expect(parsePeriod({ month: "2026-09" }, opts)).toEqual({ view: "month", month: "2026-09" });
    expect(parsePeriod({ view: "year", fy: "2025-26" }, opts)).toEqual({ view: "year", fy: "2025-26" });
    expect(parsePeriod({ month: "2026-11" }, opts)).toBeNull(); // the future
    expect(parsePeriod({ month: "2011-12" }, opts)).toBeNull(); // before joining
    expect(parsePeriod({ view: "year", fy: "2025-27" }, opts)).toBeNull();
    expect(parsePeriod({ view: "year", fy: "2027-28" }, opts)).toBeNull();
    expect(parsePeriod({}, opts)).toBeNull();
  });
});
