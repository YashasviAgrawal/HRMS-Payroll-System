import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { decide } from "@/lib/approvals/engine";
import { db } from "@/lib/db";
import { verhoeffCheckDigit } from "@/lib/validators";
import { buildTemplate, checkBulkFile, submitBulk } from "@/modules/employees/bulk";
import { proposeFamily, proposeSanctioned, sanctionedOverview, addServiceEntry, submitSelfRequest } from "@/modules/employees/records";
import { createEmployee, getEmployee, listEmployees, proposeEdit, revealIdentifier } from "@/modules/employees/service";
import { actorFor, hasTestDb, makeBoard, makeEmployee, makePost, makeSection, makeUser } from "../support/factory";

let n = 0;
const aadhaar = () => {
  const base = `5${String(3000000000 + ++n * 7717).padStart(10, "0")}`;
  return base + verhoeffCheckDigit(base);
};
const pan = () => `ABCP${String.fromCharCode(65 + (n % 26))}${String(1000 + ++n).slice(-4)}Z`;
const bank = () => `9${String(100000000 + ++n * 31).padStart(10, "0")}`;

describe.skipIf(!hasTestDb)("employee master (EM-01…EM-10)", () => {
  let boardId: string;
  let sectionId: string;
  let postId: string;
  let hr: Awaited<ReturnType<typeof actorFor>>;
  let checker: Awaited<ReturnType<typeof actorFor>>;

  beforeAll(async () => {
    boardId = (await makeBoard()).id;
    sectionId = (await makeSection(boardId)).id;
    postId = (await makePost(boardId, "6")).id;
    hr = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["HR"])).id);
    checker = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["CHECKER"])).id);
  });

  const input = (over: Record<string, unknown> = {}) => ({
    personal: { firstName: "Asha", lastName: "Rawat", gender: "F", dateOfBirth: "1990-05-05", isDisabled: false, mobile: "9876512345" },
    job: { type: "PERMANENT_NPS", sectionId, postId, dateOfJoining: "2015-04-01", payLevel: "6", payCell: 5 },
    ids: { pan: pan(), aadhaar: aadhaar(), bankAccount: bank(), ifsc: "SBIN0001234" },
    ...over,
  });

  async function approveLatest(entityId: string, who = checker) {
    const task = await db.approvalTask.findFirstOrThrow({ where: { entityId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
    return decide(who, task.id, "APPROVE");
  }

  it("a new employee stays a draft until a Checker approves; then the Employee ID is issued", async () => {
    const e = await createEmployee(hr, input());
    expect(e.status).toBe("DRAFT");
    expect(e.employeeCode).toBeNull();
    expect(e.dateOfRetirement?.toISOString().slice(0, 10)).toBe("2050-05-31");
    expect(e.panEnc).not.toContain("ABCP");
    await expect(approveLatest(e.id, hr)).rejects.toMatchObject({ status: 403 });
    await approveLatest(e.id);
    const after = await db.employee.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.employeeCode).toMatch(/^DCB\d{5}$/);
  });

  it("blocks a duplicate PAN, Aadhaar or bank account among current staff (EM-03)", async () => {
    const first = input();
    await createEmployee(hr, first);
    await expect(createEmployee(hr, input({ ids: { pan: first.ids.pan, aadhaar: aadhaar() } }))).rejects.toMatchObject({ status: 409, fields: { "ids.pan": "employees.errors.duplicateId" } });
    await expect(createEmployee(hr, input({ ids: { aadhaar: first.ids.aadhaar } }))).rejects.toMatchObject({ status: 409 });
    await expect(createEmployee(hr, input({ ids: { bankAccount: first.ids.bankAccount, ifsc: "SBIN0001234" } }))).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a bad Aadhaar, a cell that does not exist and joining under 18", async () => {
    await expect(createEmployee(hr, input({ ids: { aadhaar: "234567890123" } }))).rejects.toThrow();
    await expect(createEmployee(hr, input({ job: { type: "PERMANENT_NPS", sectionId, postId, dateOfJoining: "2015-04-01", payLevel: "16", payCell: 9 } }))).rejects.toMatchObject({
      fields: { "job.payCell": "employees.errors.noSuchCell" },
    });
    await expect(createEmployee(hr, input({ job: { type: "PERMANENT_NPS", sectionId, postId, dateOfJoining: "2005-01-01", payLevel: "6", payCell: 1 } }))).rejects.toMatchObject({
      fields: { "job.dateOfJoining": "employees.errors.under18" },
    });
  });

  it("an edit waits for a Checker, keeps the old value in history and blocks a second pending edit (EM-07)", async () => {
    const e = await createEmployee(hr, input());
    await approveLatest(e.id);
    const res = await proposeEdit(hr, e.id, "job", { type: "PERMANENT_NPS", sectionId, postId, dateOfJoining: "2015-04-01", payLevel: "6", payCell: 7 });
    expect(res.applied).toBe(false);
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).payCell).toBe(5);
    await expect(proposeEdit(hr, e.id, "personal", { firstName: "Asha Devi", gender: "F", dateOfBirth: "1990-05-05" })).rejects.toMatchObject({ key: "employees.errors.pendingChange" });
    await approveLatest(e.id);
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).payCell).toBe(7);
    const history = await db.employeeFieldHistory.findMany({ where: { employeeId: e.id, field: "payCell" } });
    expect(history[0]).toMatchObject({ oldValue: "5", newValue: "7" });
  });

  it("a new date of birth moves the retirement date (EM-02)", async () => {
    const e = await createEmployee(hr, input());
    await approveLatest(e.id);
    await proposeEdit(hr, e.id, "personal", { firstName: "Asha", lastName: "Rawat", gender: "F", dateOfBirth: "1990-06-01", mobile: "9876512345" });
    await approveLatest(e.id);
    // Born on the 1st → retires at the end of the previous month.
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).dateOfRetirement?.toISOString().slice(0, 10)).toBe("2050-05-31");
  });

  it("a bank change shows only the last four digits; revealing the full number is permitted and audited", async () => {
    const e = await createEmployee(hr, input());
    await approveLatest(e.id);
    const newBank = bank();
    await proposeEdit(hr, e.id, "ids", { bankAccount: newBank, ifsc: "PUNB0123400" });
    const task = await db.approvalTask.findFirstOrThrow({ where: { entityId: e.id, status: "PENDING" } });
    expect(JSON.stringify(task.details)).not.toContain(newBank);
    expect(JSON.stringify(task.payload)).not.toContain(newBank);
    await approveLatest(e.id);
    expect(await revealIdentifier(checker, e.id, "bankAccount")).toBe(newBank);
    expect(await db.auditLog.count({ where: { entityId: e.id, action: "VIEW_SENSITIVE" } })).toBe(1);
    const reportingOfficer = await actorFor((await makeUser(boardId, "EMPLOYEE", ["REPORTING_OFFICER"], (await makeEmployee(boardId, { sectionId })).id)).id);
    await expect(revealIdentifier(reportingOfficer, e.id, "bankAccount")).rejects.toMatchObject({ status: 403 });
  });

  it("HR cannot change their own record (PRD §2 rule 2)", async () => {
    const own = await makeEmployee(boardId, { sectionId, postId });
    const hrSelf = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["HR"], own.id)).id);
    await expect(proposeEdit(hrSelf, own.id, "personal", { firstName: "Me", gender: "M", dateOfBirth: "1990-05-05" })).rejects.toMatchObject({ key: "errors.ownPay" });
  });

  it("nominee shares must total 100% per scheme (EM-04)", async () => {
    const e = await createEmployee(hr, input());
    await approveLatest(e.id);
    const members = [
      { name: "Raj Rawat", relation: "SPOUSE", isDependent: true },
      { name: "Riya Rawat", relation: "DAUGHTER", isDependent: true },
    ];
    await expect(proposeFamily(hr, e.id, { members, nominees: [{ scheme: "GPF", memberIndex: 0, sharePercent: 60 }] })).rejects.toThrow();
    await proposeFamily(hr, e.id, { members, nominees: [{ scheme: "NPS", memberIndex: 0, sharePercent: 60 }, { scheme: "NPS", memberIndex: 1, sharePercent: 40 }] });
    await approveLatest(e.id);
    expect(await db.nominee.count({ where: { employeeId: e.id } })).toBe(2);
  });

  it("employee asks for a bank change: HR approves, then a Checker, then it applies (EM-08 + EM-07)", async () => {
    const e = await createEmployee(hr, input());
    await approveLatest(e.id);
    const me = await actorFor((await makeUser(boardId, "EMPLOYEE", [], e.id)).id);
    const newBank = bank();
    await submitSelfRequest(me, { kind: "bank", bankAccount: newBank, ifsc: "HDFC0001234" });
    await expect(submitSelfRequest(me, { kind: "bank", bankAccount: bank(), ifsc: "HDFC0001234" })).rejects.toMatchObject({ key: "employees.errors.pendingRequest" });
    await approveLatest(e.id, hr); // HR step
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).ifsc).toBe("SBIN0001234");
    await approveLatest(e.id, checker); // Checker step
    const after = await db.employee.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.ifsc).toBe("HDFC0001234");
    expect(after.bankAccountLast4).toBe(newBank.slice(-4));
  });

  it("employee changes mobile through HR; every login follows", async () => {
    const e = await createEmployee(hr, input());
    await approveLatest(e.id);
    const user = await makeUser(boardId, "EMPLOYEE", [], e.id);
    await submitSelfRequest(await actorFor(user.id), { kind: "mobile", mobile: "9811122233" });
    await approveLatest(e.id, hr);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).mobile).toBe("9811122233");
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).mobile).toBe("9811122233");
  });

  it("a promotion in the service book needs the Checker and then an Admin Approver (§14)", async () => {
    const e = await createEmployee(hr, input());
    await approveLatest(e.id);
    const entry = await addServiceEntry(hr, e.id, { event: "PROMOTION", eventDate: "2026-07-01", orderNumber: "DCB/EST/77", details: "Promoted to Head Clerk" });
    await approveLatest(entry.id);
    expect((await db.serviceBookEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe("PENDING");
    const approver = await actorFor((await makeUser(boardId, "ADMIN", ["APPROVER"])).id);
    await approveLatest(entry.id, approver);
    expect((await db.serviceBookEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe("APPROVED");
  });

  it("sanctioned vs filled, and a change to sanctioned strength through the Checker (EM-09)", async () => {
    const before = (await sanctionedOverview(hr)).rows.find((r) => r.sectionId === sectionId && r.postId === postId);
    expect(before?.filled).toBeGreaterThan(0);
    await proposeSanctioned(hr, { rows: [{ sectionId, postId, sanctioned: 40 }], orderRef: "MoD/2026/1" });
    await approveLatest(boardId);
    const after = (await sanctionedOverview(hr)).rows.find((r) => r.sectionId === sectionId && r.postId === postId)!;
    expect(after.sanctioned).toBe(40);
    expect(after.vacant).toBe(40 - after.filled);
  });

  it("a reporting officer lists only their own section", async () => {
    const other = await makeSection(boardId);
    await makeEmployee(boardId, { sectionId: other.id });
    const ro = await actorFor((await makeUser(boardId, "EMPLOYEE", ["REPORTING_OFFICER"], (await makeEmployee(boardId, { sectionId: other.id })).id)).id);
    const list = await listEmployees(ro, { pageSize: 200 });
    expect(list.rows.every((r) => r.section.id === other.id)).toBe(true);
    const outsider = await db.employee.findFirstOrThrow({ where: { boardId, sectionId } });
    await expect(getEmployee(ro, outsider.id)).rejects.toMatchObject({ status: 404 });
  });

  it("bulk upload checks every row, saves nothing on error, and issues IDs after one approval (EM-10)", async () => {
    const section = await db.section.findUniqueOrThrow({ where: { id: sectionId } });
    const post = await db.post.findUniqueOrThrow({ where: { id: postId } });
    const template = await buildTemplate(hr);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(template as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Employees")!;
    sheet.spliceRows(2, 1);
    const good = (first: string, code: string) => [code, first, "", "Singh", "", "M", "10-02-1988", "01-03-2012", "PERMANENT_NPS", section.code, post.code, "6", "3", "", "", "", "", "", "", "", "", pan(), aadhaar(), "", "", "", "", bank(), "SBIN0001234", "SBI"];
    sheet.addRow(good("Karan", "OLD9001"));
    sheet.addRow(good("Vivek", ""));
    const bad = good("Bad", "");
    bad[21] = "NOTAPAN";
    sheet.addRow(bad);
    const withError = Buffer.from(await wb.xlsx.writeBuffer());
    const rows = await checkBulkFile(hr, withError);
    expect(rows).toHaveLength(3);
    expect(rows[2].errors.join(" ")).toContain("PAN");
    const countBefore = await db.employee.count({ where: { boardId } });
    await expect(submitBulk(hr, withError, "batch.xlsx")).rejects.toMatchObject({ status: 400 });
    expect(await db.employee.count({ where: { boardId } })).toBe(countBefore);

    sheet.spliceRows(4, 1);
    const clean = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await submitBulk(hr, clean, "batch.xlsx");
    expect(res.count).toBe(2);
    await decide(checker, res.taskId, "APPROVE");
    const migrated = await db.employee.findFirstOrThrow({ where: { boardId, employeeCode: "OLD9001" } });
    expect(migrated.status).toBe("ACTIVE");
    const fresh = await db.employee.findFirstOrThrow({ where: { boardId, firstName: "Vivek" } });
    expect(fresh.employeeCode).toMatch(/^DCB\d{5}$/);
  });
});
