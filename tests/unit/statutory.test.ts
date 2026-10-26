import { describe, expect, it } from "vitest";
import { DUE_DEFAULTS, dueItems } from "@/modules/statutory/calendar";
import { craContributionFile, ecrFile, epfSplit, form24qFile, parseCraStatement } from "@/modules/statutory/formats";
import { gpfBalance, gpfInstalment, gpfLimit, gpfRefundDue, gpfYear, monthsOfFy, type GpfMove } from "@/modules/statutory/gpf-rules";
import { EMPTY_ITEMS, fyMonths, fyOfMonth, monthlyTds, monthsLeftInFy, professionalTaxFor, quarterOf, TAX_DEFAULTS, taxOnIncome, taxWorking } from "@/modules/statutory/tax-rules";
import { declaredFor, monthsStillToCome, projectTds, ZERO_PARTS, type TaxContext } from "@/modules/statutory/tds-projection";

const NEW = TAX_DEFAULTS.NEW;
const OLD = TAX_DEFAULTS.OLD;
const salary = (gross: number, extra: Partial<typeof ZERO_PARTS> = {}) => ({ ...ZERO_PARTS, gross, ...extra });

describe("ST-04 income tax on the slabs", () => {
  it("new regime: no tax up to ₹12 lakh (rebate u/s 87A), then the slabs with 4% cess", () => {
    expect(taxOnIncome(1200000, NEW, "NEW").total).toBe(0);
    expect(taxOnIncome(1600000, NEW, "NEW")).toMatchObject({ tax: 120000, rebate: 0, cess: 4800, total: 124800 });
  });

  it("new regime: marginal relief just above ₹12 lakh — tax is never more than the income above the limit", () => {
    const t = taxOnIncome(1210000, NEW, "NEW");
    expect(t.tax).toBe(61500);
    expect(t.rebate).toBe(51500);
    expect(t.total).toBe(10400);
  });

  it("old regime: rebate up to ₹5 lakh, no marginal relief above it", () => {
    expect(taxOnIncome(500000, OLD, "OLD").total).toBe(0);
    expect(taxOnIncome(1000000, OLD, "OLD").total).toBe(117000);
    expect(taxOnIncome(500010, OLD, "OLD").rebate).toBe(0);
  });

  it("rounds income down to the ₹10", () => {
    expect(taxOnIncome(1600009, NEW, "NEW").income).toBe(1600000);
  });

  it("new regime: standard deduction and the Board's NPS share only (counted in salary, then deducted u/s 80CCD(2))", () => {
    const w = taxWorking(salary(1500000, { employerNps: 100000, gpf: 50000 }), "NEW", { ...EMPTY_ITEMS, sec80C: 150000, rentPaid: 200000 }, NEW);
    expect(w.gross).toBe(1600000);
    expect(w.taxable).toBe(1425000);
    expect(w.chapterVIA.sec80C).toBe(0);
    expect(w.hraExempt).toBe(0);
    expect(w.total).toBe(Math.round((20000 + 40000 + 225000 * 0.15) * 1.04));
  });

  it("old regime: HRA exemption is the least of HRA, rent less 10% of pay, and 50% of pay in a metro", () => {
    const sal = salary(1200000, { basicDa: 600000, hra: 180000 });
    expect(taxWorking(sal, "OLD", { ...EMPTY_ITEMS, rentPaid: 240000 }, OLD).hraExempt).toBe(180000);
    expect(taxWorking(sal, "OLD", { ...EMPTY_ITEMS, rentPaid: 150000 }, OLD).hraExempt).toBe(90000);
    expect(taxWorking(sal, "OLD", { ...EMPTY_ITEMS, rentPaid: 600000 }, OLD, false).hraExempt).toBe(180000);
    expect(taxWorking({ ...sal, hra: 300000 }, "OLD", { ...EMPTY_ITEMS, rentPaid: 600000 }, OLD, false).hraExempt).toBe(240000);
  });

  it("old regime: 80C counts own NPS and GPF, all within the caps", () => {
    const w = taxWorking(salary(1200000, { employeeNps: 60000, gpf: 0 }), "OLD", { ...EMPTY_ITEMS, sec80C: 120000, sec80D: 90000, sec80CCD1B: 70000, homeLoanInterest: 250000 }, OLD);
    expect(w.chapterVIA).toEqual({ sec80C: 150000, sec80D: 75000, sec80CCD1B: 50000, homeLoanInterest: 200000 });
    expect(w.taxable).toBe(1200000 - 50000 - 150000 - 75000 - 50000 - 200000);
  });

  it("spreads what is left of the year's tax over the months left", () => {
    expect(monthlyTds(120000, 30000, 6)).toBe(15000);
    expect(monthlyTds(10000, 30000, 6)).toBe(0);
    expect(monthlyTds(10000, 0, 0)).toBe(0);
  });

  it("knows the financial year, its months and quarters", () => {
    expect(fyOfMonth("2027-01")).toBe("2026-27");
    expect(fyOfMonth("2026-04")).toBe("2026-27");
    expect(fyMonths("2026-27")).toEqual(["2026-04", "2027-03"]);
    expect([monthsLeftInFy("2026-04"), monthsLeftInFy("2026-10"), monthsLeftInFy("2027-03")]).toEqual([12, 6, 1]);
    expect([quarterOf("2026-04"), quarterOf("2026-09"), quarterOf("2026-10"), quarterOf("2027-02")]).toEqual([1, 2, 3, 4]);
    expect(monthsOfFy("2026-27")).toHaveLength(12);
    expect(monthsOfFy("2026-27").at(-1)).toBe("2027-03");
  });

  it("professional tax follows the Board's slabs", () => {
    const slabs = [
      { upTo: null, amount: 200 },
      { upTo: 7500, amount: 0 },
      { upTo: 10000, amount: 175 },
    ];
    expect([professionalTaxFor(7500, slabs), professionalTaxFor(8000, slabs), professionalTaxFor(50000, slabs), professionalTaxFor(0, slabs)]).toEqual([0, 175, 200, 0]);
  });
});

describe("ST-02/03/04 the monthly projection", () => {
  it("uses the declared deductions until December and only verified ones from January", () => {
    const d = { regime: "OLD", status: "SUBMITTED", items: { sec80C: 100000 } };
    expect(declaredFor(undefined, "2026-10")).toMatchObject({ regime: "NEW", basis: "NONE" });
    expect(declaredFor(d, "2026-12")).toMatchObject({ regime: "OLD", basis: "DECLARED", items: { sec80C: 100000 } });
    expect(declaredFor(d, "2027-01")).toMatchObject({ regime: "OLD", basis: "NONE", items: { sec80C: 0 } });
    expect(declaredFor({ ...d, status: "VERIFIED" }, "2027-02")).toMatchObject({ basis: "VERIFIED", items: { sec80C: 100000 } });
    expect(declaredFor({ ...d, status: "DRAFT" }, "2026-10")).toMatchObject({ regime: "NEW", basis: "NONE" });
  });

  it("counts the months still to come up to March or the month of leaving", () => {
    expect(monthsStillToCome("2026-10", "2026-27", null)).toBe(5);
    expect(monthsStillToCome("2026-10", "2026-27", "2026-11-30")).toBe(1);
    expect(monthsStillToCome("2026-10", "2026-27", "2026-10-15")).toBe(0);
    expect(monthsStillToCome("2027-03", "2026-27", null)).toBe(0);
  });

  it("projects the year: paid so far + this month + the months to come, less tax already deducted", () => {
    const ctx: TaxContext = { fy: "2026-27", month: "2026-10", rules: TAX_DEFAULTS, metro: true, declarations: new Map(), paid: new Map([["e1", salary(800000, { tds: 20000 })]]) };
    const t = projectTds(ctx, "e1", salary(150000), salary(150000), 5);
    expect(t.projectedGross).toBe(1700000);
    expect(t.taxable).toBe(1625000);
    expect(t.annualTax).toBe(130000);
    expect(t.monthsLeft).toBe(6);
    expect(t.monthly).toBe(18333);
    // Below ₹12.75 lakh a year in the new regime: nothing to deduct.
    expect(projectTds({ ...ctx, paid: new Map() }, "e1", salary(100000), salary(100000), 5).monthly).toBe(0);
  });
});

describe("GPF account", () => {
  const moves = (extra: GpfMove[] = []): GpfMove[] => [
    { month: "2026-03", fy: "2025-26", kind: "OPENING", amount: 100000 },
    ...monthsOfFy("2026-27").map((month) => ({ month, fy: "2026-27", kind: "SUBSCRIPTION" as const, amount: 1000 })),
    ...extra,
  ];

  it("works out interest on each month's closing balance at the rate of that month", () => {
    const y = gpfYear(moves(), "2026-27", () => 7.1);
    expect(y.opening).toBe(100000);
    expect(y.months[0].balance).toBe(101000);
    expect(y.months[11].balance).toBe(112000);
    expect(y.interest).toBe(7562);
    expect(y.closing).toBe(112000);
  });

  it("stops interest on money taken out from the month it is taken out", () => {
    const y = gpfYear(moves([{ month: "2026-10", fy: "2026-27", kind: "WITHDRAWAL", amount: -50000 }]), "2026-27", () => 7.1);
    expect(y.debits).toBe(50000);
    expect(y.interest).toBe(5787);
  });

  it("uses the rate in force each month and adds interest credited to the closing balance", () => {
    const rate = (m: string) => (m >= "2026-10" ? 7.0 : 7.1);
    const y = gpfYear(moves([{ month: "2027-03", fy: "2026-27", kind: "INTEREST", amount: 7500 }]), "2026-27", rate);
    expect(y.interestCredited).toBe(7500);
    expect(y.closing).toBe(119500);
    expect(y.interest).toBeLessThan(7562);
  });

  it("counts a balance brought in this year from the year's start, and can stop early for a final payment", () => {
    const y = gpfYear([{ month: "2026-04", fy: "2026-27", kind: "OPENING", amount: 120000 }], "2026-27", () => 7.1, "2026-09");
    expect(y.opening).toBe(120000);
    expect(y.months).toHaveLength(6);
    expect(y.interest).toBe(Math.round(120000 * 6 * 7.1 / 1200));
  });

  it("limits advances and works out instalments and what each month recovers", () => {
    expect(gpfBalance(moves(), "2026-06")).toBe(103000);
    expect(gpfLimit(100000, 75)).toBe(75000);
    expect(gpfInstalment(60000, 24)).toBe(2500);
    expect(gpfInstalment(50000, 36)).toBe(1389);
    expect(gpfRefundDue(60000, 2500, 58000)).toBe(2000);
    expect(gpfRefundDue(60000, 2500, 60000)).toBe(0);
  });
});

describe("ST-06 statutory files", () => {
  it("NPS contribution file for the CRA, one row a subscriber", () => {
    const csv = craContributionFile([{ pran: "110000001013", name: "Suresh Pal", employee: 4380, employer: 6132 }], "2026-10", "SGV012345C");
    const [head, row] = csv.trim().split(/\r?\n/);
    expect(head).toContain("PRAN");
    expect(row).toBe("1,110000001013,Suresh Pal,4380.00,6132.00,10512.00,102026,SGV012345C,");
  });

  it("reads the CRA statement by its headings and lists bad lines", () => {
    const { rows, badLines } = parseCraStatement([
      ["PRAN", "Contribution Month", "Employee Contribution", "Employer Contribution"],
      ["110000001013", "102026", "4,380.00", "6132"],
      ["11000", "102026", "100", "100"],
      ["110000002026", "2026-10", "5000", "7000"],
    ]);
    expect(rows).toEqual([
      { line: 2, pran: "110000001013", month: "2026-10", employee: 4380, employer: 6132 },
      { line: 4, pran: "110000002026", month: "2026-10", employee: 5000, employer: 7000 },
    ]);
    expect(badLines).toEqual([3]);
  });

  it("EPF: 12% on wages up to ₹15,000; EPS 8.33% of the employer share, the rest to EPF", () => {
    const s = epfSplit(20000, 21000, { epfEmployee: 12, epfEmployer: 12, epsPercent: 8.33, ceiling: 15000 });
    expect(s).toMatchObject({ epfWages: 15000, epsWages: 15000, edliWages: 15000, epfEmployee: 1800, eps: 1250, epfEpsDiff: 550 });
    const line = ecrFile([{ uan: "100900004431", name: "Ravi Prakash", ...s, ncpDays: 2 }]);
    expect(line).toBe("100900004431#~#RAVI PRAKASH#~#21000#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#2#~#0\n");
  });

  it("Form 24Q: file header, batch header, a challan and its deductees", () => {
    const text = form24qFile(
      { tan: "DELC01234E", pan: "AAALC0123K", name: "Delhi Cantonment Board", address: "Delhi Cantt", responsible: "Anil Sharma", designation: "CEO" },
      "2026-27",
      2,
      [{ bsrCode: "0510308", challanNo: "00042", depositedOn: "2026-10-07", tax: 10000, cess: 400, interest: 0, deductees: [{ pan: "ABCDE1234F", name: "Anil Sharma", paid: 201140, tds: 10400, paidOn: "2026-09-30" }] }],
      "2026-10-26",
    );
    const lines = text.trim().split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[0].startsWith("1^FH^NS1^R^26102026^1^D^DELC01234E")).toBe(true);
    expect(lines[1]).toContain("^24Q^");
    expect(lines[1]).toContain("^202728^202627^Q2^");
    expect(lines[2]).toContain("^0510308^");
    expect(lines[3]).toContain("^ABCDE1234F^");
    expect(lines[3]).toContain("^10000.00^0.00^400.00^10400.00^");
  });
});

describe("ST-08 statutory calendar", () => {
  it("lists the month's due dates with the period each is for", () => {
    const items = dueItems(DUE_DEFAULTS, "2026-10-01", "2026-10-31");
    expect(items.map((i) => `${i.code} ${i.dueOn} ${i.period}`)).toEqual([
      "NPS_CRA 2026-10-07 2026-09",
      "TDS_DEPOSIT 2026-10-07 2026-09",
      "EPF_ECR 2026-10-15 2026-09",
      "ESIC 2026-10-15 2026-09",
      "FORM_24Q 2026-10-31 2026-27 Q2",
    ]);
  });

  it("names quarters and years across the year end, and counts days after the pay bill", () => {
    const items = dueItems(DUE_DEFAULTS, "2026-12-01", "2027-06-30", new Map([["2027-02", "2027-02-26"]]));
    const find = (code: string, on: string) => items.find((i) => i.code === code && i.dueOn === on)?.period;
    expect(find("TAX_PROOFS", "2026-12-31")).toBe("2026-27");
    expect(find("FORM_24Q", "2027-01-31")).toBe("2026-27 Q3");
    expect(find("FORM_24Q", "2027-05-31")).toBe("2026-27 Q4");
    expect(find("FORM_16", "2027-06-15")).toBe("2026-27");
    expect(find("PENSION_FUND", "2027-03-02")).toBe("2027-02");
  });
});
