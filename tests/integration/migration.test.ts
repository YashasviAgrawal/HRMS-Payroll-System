import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decide } from "@/lib/approvals/engine";
import { db } from "@/lib/db";
import { fromISODate, shiftMonth, todayIST } from "@/lib/dates";
import { ratesOn } from "@/modules/payroll/compute";
import { loanPosition, loanTermsOf } from "@/modules/payroll/loan-rules";
import { buildTarget } from "@/modules/migration/build";
import { checksScreen, signCheck } from "@/modules/migration/checks";
import { issuesScreen, overviewScreen } from "@/modules/migration/console";
import { applyCutOver, cutOverScreen, proposeCutOver } from "@/modules/migration/cutover";
import { writeDbf } from "@/modules/migration/dbf";
import { exportAllData } from "@/modules/migration/export";
import { submitLoad } from "@/modules/migration/loads";
import { explainIssue, fixCell, mappingScreen, saveMapping, signMapping } from "@/modules/migration/mapping";
import { explainDiff, parallelScreen, runParallel } from "@/modules/migration/parallel";
import { listFiles, tableRows, uploadFiles } from "@/modules/migration/staging";
import { confirmOwnRecord, lockRecords, markServiceBook, markSheet, verificationList } from "@/modules/migration/verify";
import { seedLeaveTypes } from "../../prisma/seed-leave";
import { seedPayrollRules } from "../../prisma/seed-payroll";
import { actorFor, hasTestDb, makeBoard, makePost, makeSection, makeUser } from "../support/factory";

type Actor = Awaited<ReturnType<typeof actorFor>>;
const csvCell = (v: string | number) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csvFile = (name: string, rows: (string | number)[][]) => new File([rows.map((r) => r.map(csvCell).join(",")).join("\r\n")], name, { type: "text/csv" });
const letters = (n: number, seed: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + ((seed * 7 + i * 3) % 26))).join("");

/**
 * S-90 / PRD §15 end to end: FoxPro files staged with their deleted rows, mapped, cleaned and explained, loaded through
 * Checkers, compared by the six checks, a parallel-run month explained, records verified and locked, the full export.
 */
describe.skipIf(!hasTestDb)("FoxPro migration (§15, S-90)", () => {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const seed = Date.now() % 1000;
  const code = (n: number) => `FX${stamp}${n}`;
  const pan = (n: number) => `${letters(3, seed + n)}P${letters(1, seed + n + 5)}${String(1000 + ((seed + n) % 9000)).padStart(4, "0")}${letters(1, seed + n + 9)}`;
  const bank = (n: number) => `9${String(seed).padStart(4, "0")}${String(Date.now()).slice(-6)}${n}`;
  let boardId: string;
  let sectionCode: string;
  let postCode: string;
  let hr: Actor;
  let payroll: Actor;
  let pension: Actor;
  let checker: Actor;
  let admin: Actor;
  let usm: Actor;
  const files: Record<string, string> = {};

  beforeAll(async () => {
    boardId = (await makeBoard()).id;
    await seedPayrollRules(db, boardId);
    await seedLeaveTypes(db, boardId);
    const section = await makeSection(boardId);
    const post = await makePost(boardId, "6");
    sectionCode = section.code;
    postCode = post.code;
    hr = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["HR"])).id);
    payroll = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["PAYROLL"])).id);
    pension = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["PENSION"])).id);
    checker = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["CHECKER"])).id);
    admin = await actorFor((await makeUser(boardId, "ADMIN", ["APPROVER", "PAY_BILL_SIGNER"])).id);
    usm = await actorFor((await makeUser(boardId, "ADMIN", ["USER_SETTINGS_MANAGER"])).id);
  });

  afterAll(async () => {
    await db.setting.deleteMany({ where: { boardId, key: "migration.cutover" } });
    // Leave nobody on the rolls or on pension for the suites that follow.
    await db.employee.updateMany({ where: { employeeCode: { startsWith: `FX${stamp}` } }, data: { status: "RETIRED", exitDate: fromISODate("2001-01-31") } });
    await db.pensioner.updateMany({ where: { ppoNumber: { startsWith: `DCB/PPO/${stamp}/` } }, data: { status: "STOPPED", endDate: fromISODate("2001-01-31") } });
  });

  it("§15 steps 1–3: files are kept with their checksum; a DBF is staged with its deleted rows apart; memo and index files are kept frozen", async () => {
    const columns = [
      { name: "EMPNO", type: "C", length: 12, decimals: 0 },
      { name: "NAME", type: "C", length: 40, decimals: 0 },
      { name: "HNAME", type: "C", length: 40, decimals: 0 },
      { name: "SEX", type: "C", length: 1, decimals: 0 },
      { name: "DOB", type: "D", length: 8, decimals: 0 },
      { name: "DOJ", type: "C", length: 10, decimals: 0 },
      { name: "SECT", type: "C", length: 6, decimals: 0 },
      { name: "DESIG", type: "C", length: 6, decimals: 0 },
      { name: "LEVEL", type: "C", length: 2, decimals: 0 },
      { name: "CELL", type: "N", length: 2, decimals: 0 },
      { name: "PAN", type: "C", length: 10, decimals: 0 },
      { name: "ACNO", type: "C", length: 18, decimals: 0 },
      { name: "IFSC", type: "C", length: 11, decimals: 0 },
    ];
    const base = { SEX: "M", SECT: "ACCTS", DESIG: "LDC", LEVEL: "6", CELL: 3, IFSC: "SBIN0001234" };
    const { dbf } = writeDbf(columns, [
      { values: { ...base, EMPNO: code(1), NAME: "Rakesh Kumar Sharma", HNAME: "jkds'k dqekj 'kekZ", DOB: "1985-03-10", DOJ: "01/04/2015", PAN: pan(1), ACNO: bank(1) } },
      // A date FoxPro took as text and a typo in it: it is cleaned before loading.
      { values: { ...base, EMPNO: code(2), NAME: "Sunita Devi", HNAME: "lquhrk nsoh", SEX: "F", DOB: "1990-07-21", DOJ: "31/02/2016", PAN: pan(2), ACNO: bank(2) } },
      // Past the retirement age and still on the payroll: flagged, then explained in writing.
      { values: { ...base, EMPNO: code(3), NAME: "Mohan Lal", HNAME: "eksgu yky", DOB: "1955-01-15", DOJ: "15-06-1980", PAN: pan(3), ACNO: bank(3) } },
      { deleted: true, values: { ...base, EMPNO: "OLD999", NAME: "Left Long Ago", DOB: "1940-01-01", DOJ: "01/01/1960" } },
    ]);
    const res = await uploadFiles(hr, [new File([new Uint8Array(dbf)], "EMPMAST.DBF"), new File([Buffer.from("index")], "EMPMAST.CDX"), new File([Buffer.from("* FoxPro DA rule")], "SALARY.PRG")]);
    expect(res.find((r) => r.fileName === "EMPMAST.DBF")).toMatchObject({ kind: "DBF", tableName: "EMPMAST", sourceCount: 4, liveCount: 3, deletedCount: 1 });
    expect(res.filter((r) => r.kind === "OTHER")).toHaveLength(2);
    const list = await listFiles(hr);
    const emp = list.find((f) => f.fileName === "EMPMAST.DBF")!;
    expect(emp.sha256).toMatch(/^[0-9a-f]{64}$/);
    files.emp = emp.id;
    const deleted = await tableRows(hr, emp.id, { deleted: true });
    expect(deleted.rows.map((r) => r.data.EMPNO)).toEqual(["OLD999"]);
    // The User & settings manager may upload but not map.
    expect((await uploadFiles(usm, [csvFile("NOTES.CSV", [["A"], ["1"]])]))[0].kind).toBe("CSV");
    await expect(saveMapping(usm, "employees", {})).rejects.toMatchObject({ status: 403 });
  });

  it("§15 steps 4–6: the mapping sheet (suggested by column names), code lists, Kruti Dev names; problems fixed or explained", async () => {
    const screen = await mappingScreen(hr, "employees", files.emp);
    expect(screen.map.employeeCode?.column).toBe("EMPNO");
    expect(screen.map.fullName?.column).toBe("NAME");
    expect(screen.map.nameHi).toEqual({ column: "HNAME", transform: "kruti" });
    await saveMapping(hr, "employees", {
      fileId: files.emp,
      fields: { ...screen.map, type: { column: null, constant: "PERMANENT_OPS" } },
      codes: { section: { ACCTS: sectionCode }, post: { LDC: postCode } },
      options: {},
    });
    let built = await buildTarget(hr, "employees");
    expect(built.records.find((r) => r.values.employeeCode === code(1))?.values).toMatchObject({ firstName: "Rakesh", middleName: "Kumar", lastName: "Sharma", nameHi: "राकेश कुमार शर्मा", dateOfJoining: "2015-04-01", sectionCode, postCode });
    const codes = built.issues.map((i) => `${i.code}:${i.who?.split(" · ")[0]}`).sort();
    expect(codes).toEqual([`BAD_DATE:${code(2)}`, `PAST_RETIREMENT:${code(3)}`]);
    await expect(submitLoad(hr, "employees")).rejects.toMatchObject({ status: 400 });

    // Clean the date; explain the old employee (re-employed on an order, say).
    const bad = built.issues.find((i) => i.code === "BAD_DATE")!;
    const view = await issuesScreen(hr, "employees");
    expect(view.shown.find((i) => i.code === "BAD_DATE")).toMatchObject({ column: "DOJ", value: "31/02/2016" });
    await fixCell(hr, bad.rowId, { column: "DOJ", value: "01/02/2016" });
    const flag = built.issues.find((i) => i.code === "PAST_RETIREMENT")!;
    await explainIssue(hr, { key: flag.key, note: "Retained by Board resolution 14/2024 till his replacement joins" });
    built = await buildTarget(hr, "employees");
    expect(built.open).toBe(0);
    expect(built.ready).toHaveLength(3);
    // Loads need Accounts' sign-off of the sheet; a change to the sheet clears it.
    await expect(submitLoad(hr, "employees")).rejects.toMatchObject({ status: 400 });
    await expect(signMapping(hr, "employees")).rejects.toMatchObject({ status: 403 });
    await signMapping(payroll, "employees");
  });

  it("§15 step 8: employees load as one EM-10 batch through the Checker; a second load never doubles", async () => {
    const res = await submitLoad(hr, "employees");
    expect(res.count).toBe(3);
    await expect(submitLoad(hr, "employees")).rejects.toMatchObject({ status: 409 });
    await decide(checker, res.taskId, "APPROVE");
    const staff = await db.employee.findMany({ where: { employeeCode: { in: [code(1), code(2), code(3)] } }, orderBy: { employeeCode: "asc" } });
    expect(staff.map((e) => [e.employeeCode, e.status, e.nameHi])).toEqual([
      [code(1), "ACTIVE", "राकेश कुमार शर्मा"],
      [code(2), "ACTIVE", "सुनीता देवी"],
      [code(3), "ACTIVE", "मोहन लाल"],
    ]);
    const again = await buildTarget(hr, "employees");
    expect([again.loaded, again.ready.length]).toEqual([3, 0]);
  });

  it("§15 step 8: GPF balances, loans (with interest owed), tax paid outside and leave balances, each through a Checker", async () => {
    const up = await uploadFiles(payroll, [
      csvFile("GPFBAL.CSV", [["EMPNO", "CLBAL"], [code(1), "2,45,000.00"], [code(2), "1,20,500"]]),
      csvFile("LOANS.CSV", [["EMPNO", "LTYPE", "BALAMT", "INTBAL", "EMI", "RATE"], [code(1), "H", "300000", "1250", "5000", "7.9"]]),
      csvFile("TAXPAID.CSV", [["EMPNO", "GROSS", "TDS"], [code(1), "420000", "12000"]]),
    ]);
    expect(up.map((u) => u.liveCount)).toEqual([2, 1, 1]);
    const id = (t: string) => db.migrationFile.findFirstOrThrow({ where: { tableName: t, replaced: false, kind: "CSV" } }).then((f) => f.id);
    const asOn = "2026-09-30";
    await saveMapping(payroll, "gpf", { fileId: await id("GPFBAL"), fields: { employeeCode: { column: "EMPNO" }, balance: { column: "CLBAL" } }, options: { asOn } });
    await saveMapping(payroll, "loans", { fileId: await id("LOANS"), fields: { employeeCode: { column: "EMPNO" }, loanType: { column: "LTYPE" }, principalLeft: { column: "BALAMT" }, interestLeft: { column: "INTBAL" }, instalment: { column: "EMI" }, interestRate: { column: "RATE" } }, codes: { loanType: { H: "HBA" } }, options: { asOn } });
    await saveMapping(payroll, "tax", { fileId: await id("TAXPAID"), fields: { employeeCode: { column: "EMPNO" }, salary: { column: "GROSS" }, tds: { column: "TDS" } }, options: { fy: "2026-27" } });
    for (const t of ["gpf", "loans", "tax"] as const) {
      await signMapping(payroll, t);
      const r = await submitLoad(payroll, t);
      await decide(checker, r.taskId, "APPROVE");
    }
    const e1 = await db.employee.findFirstOrThrow({ where: { employeeCode: code(1) } });
    const gpf = await db.gpfEntry.findFirstOrThrow({ where: { employeeId: e1.id, kind: "OPENING" } });
    expect([Number(gpf.amount), gpf.month, gpf.fy]).toEqual([245000, "2026-09", "2026-27"]);
    const loan = await db.loan.findFirstOrThrow({ where: { employeeId: e1.id } });
    expect([loan.type, Number(loan.principal), Number(loan.openingInterest), loan.startMonth, loan.status]).toEqual(["HBA", 300000, 1250, "2026-10", "RUNNING"]);
    // The interest owed is recovered after the principal, with the interest that runs from here.
    expect(loanPosition(loanTermsOf(loan), [], "2026-10").interestTotal).toBeGreaterThan(1250);
    const carry = await db.taxCarryIn.findFirstOrThrow({ where: { employeeId: e1.id, fy: "2026-27" } });
    expect([Number(carry.salary), Number(carry.tds)]).toEqual([420000, 12000]);

    // Leave balances: one column per leave type, through LV-06's opening batch.
    const [lv] = await uploadFiles(hr, [csvFile("LEAVEBAL.CSV", [["EMPNO", "EL", "HPL", "CL"], [code(1), "120", "40", "4"], [code(2), "64.5", "20", "6"]])]);
    expect(lv.liveCount).toBe(2);
    const leaveFile = await db.migrationFile.findFirstOrThrow({ where: { tableName: "LEAVEBAL", replaced: false } });
    const screen = await mappingScreen(hr, "leave", leaveFile.id);
    expect(screen.map.EL?.column).toBe("EL");
    await saveMapping(hr, "leave", { fileId: leaveFile.id, fields: screen.map, options: { asOn } });
    await signMapping(payroll, "leave");
    const lr = await submitLoad(hr, "leave");
    await decide(checker, lr.taskId, "APPROVE");
    const el = await db.leaveLedger.findFirstOrThrow({ where: { employeeId: e1.id, leaveCode: "EL", kind: "OPENING" } });
    expect(Number(el.days)).toBe(120);
  });

  it("§15 step 8: pensioners from the old records — the former employee is created, the bank number sealed, Kruti Dev names read", async () => {
    const rates = await ratesOn(boardId, `${todayIST().slice(0, 7)}-01`, db);
    const dr = Math.round((22000 * (rates.DA_PERCENT ?? 0)) / 100);
    await uploadFiles(pension, [
      csvFile("PENMAST.CSV", [
        ["PPONO", "PTYPE", "NAME", "HNAME", "PDOB", "SEX", "DOJ", "DOR", "ACNO", "IFSC", "PENSION", "DR", "PENFROM"],
        [`DCB/PPO/${stamp}/1`, "S", "Hari Om Gupta", "gfj vkse xqIrk", "12/05/1958", "M", "01/07/1982", "31/05/2018", bank(7), "PUNB0123400", "22000", String(dr), "01/06/2018"],
      ]),
    ]);
    const f = await db.migrationFile.findFirstOrThrow({ where: { tableName: "PENMAST", replaced: false } });
    const screen = await mappingScreen(pension, "pensioners", f.id);
    expect(screen.map.ppoNumber?.column).toBe("PPONO");
    expect(screen.map.payeeNameHi).toEqual({ column: "HNAME", transform: "kruti" });
    await saveMapping(pension, "pensioners", {
      fileId: f.id,
      fields: { ...screen.map, pensionType: { column: "PTYPE" }, retireeGender: { column: "SEX" }, dateOfJoining: { column: "DOJ" }, lastBasicPaid: { column: "PENSION" }, lastDrPaid: { column: "DR" } },
      codes: { pensionType: { S: "SUPERANNUATION" } },
      options: { sectionCode, postCode },
    });
    const built = await buildTarget(pension, "pensioners");
    expect(built.issues).toEqual([]);
    await signMapping(payroll, "pensioners");
    const r = await submitLoad(pension, "pensioners");
    const task = await db.approvalTask.findUniqueOrThrow({ where: { id: r.taskId } });
    expect(JSON.stringify(task.payload)).not.toContain(bank(7));
    await decide(checker, r.taskId, "APPROVE");
    const p = await db.pensioner.findFirstOrThrow({ where: { ppoNumber: `DCB/PPO/${stamp}/1` }, include: { employee: true } });
    expect([p.payeeNameHi, Number(p.basicPension), p.employee.status, p.employee.firstName, p.relation]).toEqual(["हरि ओम गुप्ता", 22000, "RETIRED", "Hari", "SELF"]);
  });

  it("§15 checks table: worked out from the data and signed by the people the PRD names", async () => {
    // Money totals: FoxPro's pay data summed by month against its own printed figures.
    const m1 = "2026-08";
    const m2 = "2026-09";
    await uploadFiles(payroll, [csvFile("PAYTOTAL.CSV", [["MONTH", "EMPNO", "GROSS", "DEDN", "NET"], ["08/2026", code(1), "80000", "12000", "68000"], ["08/2026", code(2), "60000", "8000", "52000"], ["09/2026", code(1), "80000", "12000", "68000"]])]);
    const pt = await db.migrationFile.findFirstOrThrow({ where: { tableName: "PAYTOTAL", replaced: false } });
    await saveMapping(payroll, "payTotals", { fileId: pt.id, fields: { month: { column: "MONTH" }, employeeCode: { column: "EMPNO" }, gross: { column: "GROSS" }, deductions: { column: "DEDN" }, net: { column: "NET" } }, options: { control: { [m1]: { gross: 140000, deductions: 20000, net: 120000 }, [m2]: { gross: 80000, deductions: 12000, net: 68000 } } } });
    const screen = await checksScreen(payroll);
    const by = Object.fromEntries(screen.checks.map((c) => [c.code, c]));
    expect(by.RECORD_COUNTS.pass).toBe(true);
    expect(by.MONEY_TOTALS.pass).toBe(true);
    expect(by.MONEY_TOTALS.rows.map((r) => r.label)).toEqual([m1, m2]);
    expect(by.GPF.pass).toBe(true);
    expect(by.PENSION.pass).toBe(true);
    expect(by.DUPLICATES.pass).toBe(true);
    expect(by.EXCEPTIONS.pass).toBe(true);
    expect(by.MONEY_TOTALS.canSign).toBe("PAYROLL");
    await signCheck(payroll, "MONEY_TOTALS");
    await signCheck(admin, "MONEY_TOTALS");
    await signCheck(checker, "RECORD_COUNTS");
    await expect(signCheck(checker, "RECORD_COUNTS")).rejects.toMatchObject({ status: 409 });
    await expect(signCheck(hr, "GPF")).rejects.toMatchObject({ status: 403 });
    const after = await checksScreen(admin);
    expect(after.checks.find((c) => c.code === "MONEY_TOTALS")).toMatchObject({ done: true });

    // A wrong control figure makes the check fail (and it can no longer be signed by anyone who has not).
    await saveMapping(payroll, "payTotals", { fileId: pt.id, fields: { month: { column: "MONTH" }, employeeCode: { column: "EMPNO" }, gross: { column: "GROSS" }, deductions: { column: "DEDN" }, net: { column: "NET" } }, options: { control: { [m1]: { gross: 140002, deductions: 20000, net: 120002 }, [m2]: { gross: 80000, deductions: 12000, net: 68000 } } } });
    expect((await checksScreen(admin)).checks.find((c) => c.code === "MONEY_TOTALS")?.pass).toBe(false);
  });

  it("§15 step 9: the parallel run lists every difference over ₹1 per person and head; explained, the month counts", async () => {
    const month = "2018-11";
    const e1 = await db.employee.findFirstOrThrow({ where: { employeeCode: code(1) } });
    const run = await db.payrollRun.create({ data: { boardId, payGroup: "NPS", month, status: "DRAFT", runById: payroll.userId, runByName: "Test", runAt: new Date() } });
    const lines = [
      { code: "BASIC", name: "Basic", nameHi: "मूल", kind: "EARNING", amount: 35400, accountHead: "A" },
      { code: "DA", name: "DA", nameHi: "डीए", kind: "EARNING", amount: 17700, accountHead: "A" },
      { code: "NPS", name: "NPS", nameHi: "एनपीएस", kind: "DEDUCTION", amount: 5310, accountHead: "D" },
    ];
    await db.payslip.create({ data: { boardId, runId: run.id, employeeId: e1.id, month, payGroup: "NPS", sectionId: e1.sectionId, postId: e1.postId, daysInMonth: 30, daysOnRoll: 30, lines, gross: 53100, deductions: 5310, net: 47790, employer: 0 } });
    await uploadFiles(payroll, [csvFile("SAL1118.CSV", [["EMPNO", "PCODE", "AMT"], [code(1), "BP", "35400"], [code(1), "DA", "17750"], [code(1), "NPS", "5310.50"], [code(2), "BP", "28000"]])]);
    const sal = await db.migrationFile.findFirstOrThrow({ where: { tableName: "SAL1118", replaced: false } });
    await saveMapping(payroll, "parallel", { fileId: sal.id, fields: { employeeCode: { column: "EMPNO" }, head: { column: "PCODE" }, amount: { column: "AMT" } }, codes: { head: { BP: "BASIC", DA: "DA", NPS: "NPS" } }, options: { layout: "long" } });
    const res = await runParallel(payroll, { month, fileId: sal.id });
    expect(res).toMatchObject({ people: 2, matched: 0, diffs: 2 });
    const screen = await parallelScreen(payroll, month);
    // NPS differs by 50 paise only — within ₹1, so not listed.
    expect(screen.open!.diffs.map((d) => `${d.employeeCode}:${d.head}:${d.fox}:${d.ours}`).sort()).toEqual([`${code(1)}:DA:17750:17700`, `${code(2)}:NOT_PAID_HERE:28000:0`]);
    expect(screen.streak).toBe(0);
    for (const d of screen.open!.diffs) await explainDiff(payroll, d.id, { note: d.head === "DA" ? "FoxPro used last year's DA table; corrected there" : "Left the Board on 31 October; FoxPro not updated" });
    const after = await parallelScreen(payroll, month);
    expect([after.months[0].ok, after.streak]).toEqual([true, 1]);
    // Running the month again keeps explanations for differences that are still the same.
    await runParallel(payroll, { month, fileId: sal.id });
    expect((await parallelScreen(payroll, month)).months[0].explained).toBe(2);
  });

  it("§15 step 7: records compared with the service book, confirmed by the person or on a signed sheet, then locked by a Checker", async () => {
    const staff = await db.employee.findMany({ where: { employeeCode: { in: [code(1), code(2)] } }, orderBy: { employeeCode: "asc" } });
    const me = await actorFor((await makeUser(boardId, "EMPLOYEE", [], staff[0].id)).id);
    await markServiceBook(hr, { kind: "staff", ids: staff.map((s) => s.id) });
    await confirmOwnRecord(me);
    await markSheet(hr, { kind: "staff", ids: [staff[1].id] });
    const res = await lockRecords(checker, { kind: "staff", ids: staff.map((s) => s.id) });
    expect(res).toEqual({ count: 2, skipped: 0 });
    const list = await verificationList(checker, "staff", { q: `FX${stamp}` });
    expect(list.rows.filter((r) => r.locked).map((r) => r.code)).toEqual([code(1), code(2)]);
    expect(list.rows.find((r) => r.code === code(1))?.confirmed?.via).toBe("SELF");
    expect(list.rows.find((r) => r.code === code(3))?.locked).toBeNull();
    await expect(lockRecords(checker, { kind: "staff", ids: [list.rows.find((r) => r.code === code(3))!.id] })).rejects.toMatchObject({ status: 400 });
  });

  it("§15 step 10: the cut-over waits until everything is ready; once the Admin signs, the console is read-only", async () => {
    const screen = await cutOverScreen(hr);
    expect(screen.canPropose).toBe(false);
    expect(screen.ready.find((r) => r.key === "parallel")).toMatchObject({ ok: false, vars: { streak: 1 } });
    await expect(proposeCutOver(hr, { date: "2026-11-01" })).rejects.toMatchObject({ status: 400 });
    // The Admin's approval (the approval itself is covered by the kind; here its effect).
    const task = await db.approvalTask.create({ data: { boardId, kind: "migration.cutover", title: "t", payload: { date: "2026-11-01" }, requiredPermission: "APPROVER", entityType: "MigrationCutOver", makerId: hr.userId, makerName: hr.name } });
    await db.$transaction((tx) => applyCutOver(tx, task, admin, "2026-11-01"));
    expect((await overviewScreen(admin)).cutOver).toMatchObject({ date: "2026-11-01" });
    await expect(uploadFiles(hr, [csvFile("LATE.CSV", [["A"], ["1"]])])).rejects.toMatchObject({ status: 409 });
    await expect(signMapping(payroll, "payTotals")).rejects.toMatchObject({ status: 409 });
  });

  it("§16 data ownership: every table as CSV and JSON for the Admin, without sign-in secrets; logged", async () => {
    await expect(exportAllData(payroll)).rejects.toMatchObject({ status: 403 });
    const { buffer, fileName } = await exportAllData(admin);
    expect(fileName).toMatch(/^DCB-HRMS-data-\d{4}-\d{2}-\d{2}\.zip$/);
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("csv/Employee.csv")).toBeTruthy();
    expect(zip.file("json/Session.json")).toBeNull();
    expect(zip.file("json/OtpChallenge.json")).toBeNull();
    const users = JSON.parse(await zip.file("json/User.json")!.async("string")) as Record<string, unknown>[];
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((u) => !("passwordHash" in u))).toBe(true);
    const employees = await zip.file("csv/Employee.csv")!.async("string");
    expect(employees).toContain(code(1));
    expect(await db.auditLog.findFirst({ where: { boardId, action: "EXPORT", userId: admin.userId } })).toBeTruthy();
  }, 60_000);

  it("keeps the month boundaries honest: as-on balances sit in the month before the cut-over", () => {
    expect(shiftMonth("2026-09", 1)).toBe("2026-10");
    expect(fromISODate("2026-09-30").toISOString().slice(0, 10)).toBe("2026-09-30");
  });
});
