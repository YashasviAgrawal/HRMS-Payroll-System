import { describe, expect, it } from "vitest";
import { readDbf, writeDbf } from "@/modules/migration/dbf";
import { krutiToUnicode, looksLikeKruti } from "@/modules/migration/krutidev";

describe("§15 step 2: Kruti Dev 010 names to Unicode", () => {
  it.each([
    ["jkds'k", "राकेश"],
    ["lquhy dqekj", "सुनील कुमार"],
    ["fiz;k", "प्रिया"],
    ["'kekZ", "शर्मा"],
    ["xqIrk", "गुप्ता"],
    ["lat; flag", "संजय सिंह"],
    ["vfuy", "अनिल"],
    ["fnus'k", "दिनेश"],
    ["y{eh", "लक्ष्मी"],
    ["lqjs'k pUnz", "सुरेश चन्द्र"],
    ["deZpkjh", "कर्मचारी"],
    ["fo|ky;", "विद्यालय"],
    ["Jherh", "श्रीमती"],
    ["/keZsUnz", "धर्मेन्द्र"],
    ["[kUuk", "खन्ना"],
    ["Hkkjrh", "भारती"],
    ["dkS'kY;k", "कौशल्या"],
    ["vkse izdk'k", "ओम प्रकाश"],
    ["bZ'oj", "ईश्वर"],
    ["mek", "उमा"],
  ])("%s → %s", (kruti, unicode) => {
    expect(krutiToUnicode(kruti)).toBe(unicode);
  });

  it("tells Kruti Dev text from English", () => {
    expect(looksLikeKruti("jkds'k 'kekZ")).toBe(true);
    expect(looksLikeKruti("Rakesh Sharma")).toBe(false);
    expect(looksLikeKruti("राकेश")).toBe(false);
  });
});

describe("§15 steps 1–3: FoxPro tables are read exactly as they are", () => {
  const columns = [
    { name: "EMPNO", type: "C", length: 8, decimals: 0 },
    { name: "NAME", type: "C", length: 30, decimals: 0 },
    { name: "BASIC", type: "N", length: 10, decimals: 2 },
    { name: "DOB", type: "D", length: 8, decimals: 0 },
    { name: "ACTIVE", type: "L", length: 1, decimals: 0 },
    { name: "REMARKS", type: "M", length: 10, decimals: 0 },
  ];
  const rows = [
    { values: { EMPNO: "F001", NAME: "jkds'k 'kekZ", BASIC: 35400.5, DOB: "1980-02-29", ACTIVE: true, REMARKS: "Promoted 2019; order no. 12/2019" } },
    { deleted: true, values: { EMPNO: "F002", NAME: "Old Record", BASIC: 0, DOB: null, ACTIVE: false, REMARKS: null } },
    { values: { EMPNO: "F003", NAME: "Meena Devi", BASIC: null, DOB: "1975-12-31", ACTIVE: null, REMARKS: null } },
  ];

  it("reads fields, dates, logicals, memos and keeps deleted rows apart", () => {
    const { dbf, fpt } = writeDbf(columns, rows);
    const t = readDbf(dbf, fpt ?? undefined);
    expect(t.count).toBe(3);
    expect(t.updated).toBe("2026-10-27");
    expect(t.columns.map((c) => `${c.name}:${c.type}`)).toEqual(["EMPNO:C", "NAME:C", "BASIC:N", "DOB:D", "ACTIVE:L", "REMARKS:M"]);
    expect(t.rows.map((r) => r.deleted)).toEqual([false, true, false]);
    expect(t.rows[0].values).toEqual({ EMPNO: "F001", NAME: "jkds'k 'kekZ", BASIC: 35400.5, DOB: "1980-02-29", ACTIVE: true, REMARKS: "Promoted 2019; order no. 12/2019" });
    expect(t.rows[2].values).toMatchObject({ BASIC: null, ACTIVE: null, REMARKS: null });
    expect(t.missingMemos).toBe(0);
  });

  it("counts memos it cannot find when the .FPT is missing", () => {
    const { dbf } = writeDbf(columns, rows);
    expect(readDbf(dbf).missingMemos).toBe(1);
  });

  it("refuses files that are not tables", () => {
    expect(() => readDbf(Buffer.from("PK\u0003\u0004 not a dbf at all, just some zip-looking bytes"))).toThrow(/Not a DBF/);
  });
});
