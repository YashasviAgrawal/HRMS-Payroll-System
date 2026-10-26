import { describe, expect, it } from "vitest";
import { parseAttlog, parseDateText, parsePunchFile, parseRows, parseTimeText, punchTemplate, splitDelimited } from "@/modules/attendance/formats";

describe("reading dates and times from device exports (AT-01)", () => {
  it("reads Indian day-first dates, ISO dates and month names", () => {
    expect(parseDateText("01-10-2026")).toBe("2026-10-01");
    expect(parseDateText("1/10/2026")).toBe("2026-10-01");
    expect(parseDateText("2026-10-01")).toBe("2026-10-01");
    expect(parseDateText("01-Oct-2026")).toBe("2026-10-01");
    expect(parseDateText("31-02-2026")).toBeNull();
  });

  it("reads 24-hour and AM/PM times", () => {
    expect(parseTimeText("9:05")).toBe("09:05");
    expect(parseTimeText("17:41:09")).toBe("17:41");
    expect(parseTimeText("9:05 PM")).toBe("21:05");
    expect(parseTimeText("12:10 am")).toBe("00:10");
    expect(parseTimeText("25:00")).toBeNull();
  });
});

describe("punch file formats", () => {
  it("reads ZKTeco attlog lines and reports the line that is not one", () => {
    const r = parseAttlog("   10003\t2026-10-01 09:02:11\t1\t0\t1\t0\n10003\t2026-10-01 17:44:02\t1\t0\nnot a punch");
    expect(r.punches).toHaveLength(2);
    expect(r.punches[0]).toMatchObject({ biometricId: "10003", date: "2026-10-01", time: "09:02" });
    expect(r.punches[0].at.toISOString()).toBe("2026-10-01T03:32:00.000Z");
    expect(r.errors).toEqual([{ line: 3, key: "attendance.import.badRow", text: "not a punch" }]);
  });

  it("reads an eSSL device-log export with one date-time column", () => {
    const rows = splitDelimited('Employee Code,Employee Name,Log Date,Direction\n10003,"Singh, Priya",01/10/2026 09:02:11,in\n10004,Mohit,01/10/2026 9:20 AM,in\n,Nobody,01/10/2026 09:00,in');
    const r = parseRows(rows, "ESSL");
    expect(r.punches.map((p) => [p.biometricId, p.time])).toEqual([
      ["10003", "09:02"],
      ["10004", "09:20"],
    ]);
    expect(r.errors[0]).toMatchObject({ line: 4, key: "attendance.import.noId" });
  });

  it("reads Mantra date and time columns, and AEBAS in and out times", () => {
    expect(parseRows(splitDelimited("EmpCode;Date;Time\n10003;01-10-2026;09:01"), "MANTRA").punches[0]).toMatchObject({ date: "2026-10-01", time: "09:01" });
    const aebas = parseRows(splitDelimited("Attendance ID\tName\tDate\tIn Time\tOut Time\n10003\tPriya\t01-10-2026\t09:03\t17:50\n10004\tMohit\t01-10-2026\t09:10\t--"), "AEBAS");
    expect(aebas.punches.map((p) => `${p.biometricId} ${p.time}`)).toEqual(["10003 09:03", "10003 17:50", "10004 09:10"]);
    expect(aebas.errors).toEqual([]);
  });

  it("says a file is unreadable when no heading names an ID", () => {
    expect(parseRows(splitDelimited("Name,When\nPriya,01-10-2026 09:00"), "ESSL").unreadable).toBe(true);
  });

  it("reads the Board's own Excel template", async () => {
    const r = await parsePunchFile(await punchTemplate(), "punches.xlsx", "TEMPLATE");
    expect(r.unreadable).toBe(false);
    expect(r.punches.map((p) => `${p.biometricId} ${p.date} ${p.time}`)).toEqual(["10003 2026-10-01 09:02", "10003 2026-10-01 17:41"]);
  });
});
