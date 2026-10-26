import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { buildBankFile, parseReturnRows, paymentMode } from "@/modules/payroll/bank-formats";
import { changePct, EXCEPTION_RULES, exceptionKey, preChecks, type SlipFacts } from "@/modules/payroll/checks";

const slip = (over: Partial<SlipFacts> = {}): SlipFacts => ({ employeeId: "e1", net: 50000, lastNet: 50000, hasBank: true, bankHash: "h1", afterRetirement: false, noPayLevel: false, suspended: false, ...over });
const codes = (s: SlipFacts, holders = new Map([["h1", 1]])) => preChecks([s], holders).map((f) => f.code);

describe("PR-10 pre-checks", () => {
  it("passes a normal pay", () => {
    expect(codes(slip())).toEqual([]);
  });

  it("finds each problem the PRD lists", () => {
    expect(codes(slip({ hasBank: false, bankHash: null }))).toEqual(["NO_BANK"]);
    expect(codes(slip({ net: -120 }))).toContain("NEGATIVE_NET");
    expect(codes(slip({ afterRetirement: true }))).toEqual(["AFTER_RETIREMENT"]);
    expect(codes(slip(), new Map([["h1", 2]]))).toEqual(["DUPLICATE_BANK"]);
    expect(codes(slip({ net: 37000 }))).toEqual(["NET_CHANGE"]);
    expect(codes(slip({ net: 63000 }))).toEqual(["NET_CHANGE"]);
  });

  it("treats exactly 25% as no warning and a first salary as nothing to compare", () => {
    expect(codes(slip({ net: 62500 }))).toEqual([]);
    expect(codes(slip({ lastNet: null, net: 1 }))).toEqual([]);
    expect(changePct(40000, 50000)).toBe(-20);
    expect(changePct(1, 0)).toBeNull();
  });

  it("blocks everything except the net change, which is a remark for the Checker", () => {
    expect(Object.entries(EXCEPTION_RULES).filter(([, r]) => r.severity === "WARN").map(([c]) => c)).toEqual(["NET_CHANGE"]);
    expect(EXCEPTION_RULES.NO_BANK.resolutions).toEqual(["WITHHELD"]);
    expect(EXCEPTION_RULES.ATTENDANCE_NOT_LOCKED.resolutions).toContain("WAIVED");
  });

  it("keys a section-level exception by its section", () => {
    expect(exceptionKey({ employeeId: null, code: "ATTENDANCE_NOT_LOCKED", vars: { sectionId: "s1" } })).toBe("|ATTENDANCE_NOT_LOCKED|s1");
    expect(exceptionKey({ employeeId: "e1", code: "NO_BANK" })).toBe("e1|NO_BANK|");
  });
});

describe("PR-12 bank files", () => {
  const rows = [
    { employeeCode: "DCB10001", name: "Anil Sharma", account: "30001112223334", ifsc: "SBIN0001234", amount: 186020, narration: "DCB SALARY 202610 DCB10001" },
    { employeeCode: "DCB10002", name: "Sunita O'Neil-Verma", account: "1234567890", ifsc: "PUNB0123400", amount: 143460.5, narration: "DCB SALARY 202610 DCB10002" },
  ];

  it("uses an internal transfer for the Board's own bank and NEFT otherwise", () => {
    expect(paymentMode("SBIN0009999", "SBIN0001234")).toBe("INTERNAL");
    expect(paymentMode("PUNB0123400", "SBIN0001234")).toBe("NEFT");
    expect(paymentMode("PUNB0123400", "")).toBe("NEFT");
  });

  it("writes each bank's layout with two-decimal amounts and clean names", () => {
    const generic = parseCsv(buildBankFile("GENERIC_CSV", rows, { debitIfsc: "SBIN0001234", valueDate: "2026-10-31" }).content);
    expect(generic[0][0]).toBe("Sl No");
    expect(generic[2]).toEqual(["2", "DCB10002", "SUNITA O NEIL VERMA", "1234567890", "PUNB0123400", "143460.50", "NEFT", "DCB SALARY 202610 DCB10002"]);
    const sbi = parseCsv(buildBankFile("SBI_CMP", rows, { debitIfsc: "SBIN0001234", valueDate: "2026-10-31" }).content);
    expect(sbi[1]).toEqual(["ANIL SHARMA", "30001112223334", "SBIN0001234", "IFT", "186020.00", "31/10/2026", "DCB SALARY 202610 DCB10001"]);
    const canara = buildBankFile("CANARA_BULK", rows, { debitIfsc: "CNRB0001234", valueDate: "2026-10-31" });
    expect(canara.ext).toBe("txt");
    expect(canara.content.split("\r\n")[0]).toBe("30001112223334|ANIL SHARMA|SBIN0001234|186020.00|N|DCB SALARY 202610 DCB10001");
  });

  it("reads a return file by its headings, in any order, and reports bad lines", () => {
    const ok = parseReturnRows(parseCsv("Reason,Status,Employee ID,Amount\nAccount closed,FAILED,dcb10002,\"1,43,460.50\"\n,SUCCESS,DCB10001,186020\n"));
    expect(ok.errors).toEqual([]);
    expect(ok.rows).toEqual([
      { line: 2, employeeCode: "DCB10002", amount: 143460.5, failed: true, reason: "Account closed" },
      { line: 3, employeeCode: "DCB10001", amount: 186020, failed: false, reason: "" },
    ]);
    const bad = parseReturnRows(parseCsv("Employee ID,Amount,Status\nDCB1,abc,FAILED\nDCB2,10,MAYBE\n,10,FAILED\n"));
    expect(bad.errors.map((e) => [e.line, e.problem])).toEqual([
      [2, "badAmount"],
      [3, "badStatus"],
      [4, "noEmployee"],
    ]);
    expect(parseReturnRows([["Name", "Total"]]).errors[0].problem).toBe("noColumns");
  });
});

describe("CSV reader", () => {
  it("handles quotes, doubled quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,"b,c","say ""hi"""\r\n1,2,3')).toEqual([
      ["a", "b,c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });
});
