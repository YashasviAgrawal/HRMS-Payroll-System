import { describe, expect, it } from "vitest";
import { computePay, transportAllowance, type HeadRule, type PayInput } from "@/modules/payroll/engine";
import { PAY_HEAD_DEFAULTS } from "@/modules/payroll/head-defaults";
import { RATE_DEFAULTS } from "@/modules/payroll/rate-catalog";
import { basicPay } from "@/modules/payroll/matrix-7cpc";

const heads: HeadRule[] = PAY_HEAD_DEFAULTS.map((h) => ({ ...h, value: h.value ?? 0, postCodes: h.postCodes ?? [], prorate: h.prorate ?? true, countsForDa: h.countsForDa ?? false }));
/** Rates in force on 1 Oct 2026 (latest value on or before). */
const rates = Object.fromEntries(
  [...new Set(RATE_DEFAULTS.map(([k]) => k))].map((k) => [k, RATE_DEFAULTS.filter(([key, , from]) => key === k && from <= "2026-10-01").sort((a, b) => a[2].localeCompare(b[2])).at(-1)![1]]),
);
const base: PayInput = { type: "PERMANENT_NPS", postCode: "UDC", group: "C", payLevel: "6", basic: basicPay("6", 1), wageRate: null, wageBasis: null, daysInMonth: 31, daysOnRoll: 31, last: { daysInMonth: 30, lossDays: 0, halfPayDays: 0, workedDays: 22 }, rates, heads, items: {} };
const amount = (r: ReturnType<typeof computePay>, code: string) => r.lines.find((l) => l.code === code)?.amount ?? 0;

describe("pay engine — the PRD worked example (§8)", () => {
  it("Level 6, Cell 1, NPS, Delhi: gross 73,020 and NPS 5,664 exactly", () => {
    const r = computePay(base);
    expect(amount(r, "BASIC")).toBe(35400);
    expect(amount(r, "DA")).toBe(21240);
    expect(amount(r, "HRA")).toBe(10620);
    expect(amount(r, "TA")).toBe(3600);
    expect(amount(r, "DA_TA")).toBe(2160);
    expect(r.gross).toBe(73020);
    expect(amount(r, "NPS")).toBe(5664);
    expect(amount(r, "NPS_ER")).toBe(Math.round(0.14 * 56640));
    expect(amount(r, "GIS")).toBe(30);
    expect(r.net).toBe(73020 - 5664 - 30);
  });
});

describe("pay engine — days, groups and schemes", () => {
  it("reduces pay for last month's dies-non, and halves Basic and DA (not HRA/TA) for half-pay leave", () => {
    const loss = computePay({ ...base, last: { daysInMonth: 30, lossDays: 3, halfPayDays: 0, workedDays: 19 } });
    expect(amount(loss, "BASIC")).toBe(Math.round(35400 * (1 - 3 / 30)));
    expect(amount(loss, "HRA")).toBe(Math.round(10620 * (1 - 3 / 30)));
    const hpl = computePay({ ...base, last: { daysInMonth: 30, lossDays: 0, halfPayDays: 6, workedDays: 16 } });
    expect(amount(hpl, "BASIC")).toBe(Math.round(35400 * (1 - 3 / 30)));
    expect(amount(hpl, "HRA")).toBe(10620);
    expect(amount(hpl, "DA")).toBe(Math.round(amount(hpl, "BASIC") * 0.6));
  });

  it("pays a joiner from the date of joining (pro-rata, RO-06)", () => {
    const r = computePay({ ...base, daysOnRoll: 10, last: null });
    expect(amount(r, "BASIC")).toBe(Math.round((35400 * 10) / 31));
  });

  it("deducts GPF (subscription or the 6% minimum) and works out the Board's pension contribution for OPS staff", () => {
    const r = computePay({ ...base, type: "PERMANENT_OPS", payLevel: "4", basic: basicPay("4", 10) });
    expect(amount(r, "GPF")).toBe(Math.round(basicPay("4", 10)! * 0.06));
    expect(amount(r, "NPS")).toBe(0);
    expect(amount(r, "PENSION_ER")).toBeGreaterThan(0);
    expect(amount(computePay({ ...base, type: "PERMANENT_OPS", items: { GPF: 5000 } }), "GPF")).toBe(5000);
  });

  it("adds NPA for doctors, counting it for DA and NPS", () => {
    const r = computePay({ ...base, postCode: "MO", payLevel: "10", basic: 56100, group: "A" });
    expect(amount(r, "NPA")).toBe(11220);
    expect(amount(r, "DA")).toBe(Math.round((56100 + 11220) * 0.6));
    expect(amount(r, "NPS")).toBe(Math.round((56100 + 11220 + amount(r, "DA")) * 0.1));
    expect(amount(r, "GIS")).toBe(120);
  });

  it("pays daily wages for days worked last month, with EPF on the ceiling and ESIC below its limit", () => {
    const r = computePay({ ...base, type: "DAILY_WAGE", postCode: "SK", payLevel: null, basic: null, wageRate: 843, wageBasis: "DAILY", last: { daysInMonth: 30, lossDays: 0, halfPayDays: 0, workedDays: 22 } });
    expect(amount(r, "WAGES")).toBe(843 * 22);
    expect(amount(r, "WASHING")).toBe(150); // safai karamchari allowances
    expect(amount(r, "EPF")).toBe(Math.round(0.12 * 15000));
    expect(amount(r, "ESIC")).toBe(Math.ceil(0.0075 * r.gross));
    expect(amount(r, "GIS")).toBe(0);
  });

  it("takes standing deductions (licence fee, TDS) and can go negative for the pre-check to catch", () => {
    const r = computePay({ ...base, items: { LICENCE: 1200, IT: 2500 } });
    expect(amount(r, "LICENCE")).toBe(1200);
    expect(r.deductions).toBe(5664 + 30 + 1200 + 2500);
    expect(computePay({ ...base, items: { RECOVERY: 90000 } }).net).toBeLessThan(0);
  });

  it("knows the transport allowance tiers", () => {
    expect(transportAllowance("10", 56100, rates)).toBe(7200);
    expect(transportAllowance("2", 19900, rates)).toBe(1350);
    expect(transportAllowance("2", 24500, rates)).toBe(3600);
  });
});
