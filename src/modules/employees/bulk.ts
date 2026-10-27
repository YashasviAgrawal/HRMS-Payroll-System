import "server-only";
import ExcelJS from "exceljs";
import { submitForApproval } from "@/lib/approvals/engine";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { blindIndex } from "@/lib/crypto";
import { db } from "@/lib/db";
import { isISODate, toISODate } from "@/lib/dates";
import { badRequest, forbidden } from "@/lib/errors";
import { lookup } from "@/lib/i18n/types";
import { en } from "@/lib/i18n/en";
import { createEmployeeSchema, crossCheck, EMPLOYEE_TYPES } from "./schema";
import { ACTIVE_STATUSES, createEmployee } from "./service";

/**
 * EM-10: bulk upload from an Excel template, for the FoxPro migration and for new batches.
 * Nothing is saved unless every row is correct; the batch then goes to a Checker as one approval.
 */
export const BULK_COLUMNS: { key: string; header: string; width: number; required?: boolean; note?: string }[] = [
  { key: "employeeCode", header: "Employee ID", width: 14, note: "Leave empty for new staff. Fill the old FoxPro ID when migrating." },
  { key: "firstName", header: "First name", width: 16, required: true },
  { key: "middleName", header: "Middle name", width: 14 },
  { key: "lastName", header: "Last name", width: 16 },
  { key: "nameHi", header: "Name in Hindi", width: 20 },
  { key: "gender", header: "Gender (M/F/T)", width: 10, required: true },
  { key: "dateOfBirth", header: "Date of birth (DD-MM-YYYY)", width: 16, required: true },
  { key: "dateOfJoining", header: "Date of joining (DD-MM-YYYY)", width: 16, required: true },
  { key: "type", header: "Employee type", width: 18, required: true, note: EMPLOYEE_TYPES.join(" / ") },
  { key: "sectionCode", header: "Section code", width: 12, required: true },
  { key: "postCode", header: "Post code", width: 12, required: true },
  { key: "payLevel", header: "Pay level", width: 9 },
  { key: "payCell", header: "Cell", width: 7 },
  { key: "wageRate", header: "Wage rate (contract/daily)", width: 14 },
  { key: "wageBasis", header: "Wage paid (MONTHLY/DAILY)", width: 14 },
  { key: "contractStart", header: "Contract from (DD-MM-YYYY)", width: 16 },
  { key: "contractEnd", header: "Contract to (DD-MM-YYYY)", width: 16 },
  { key: "mobile", header: "Mobile", width: 13 },
  { key: "email", header: "Email", width: 22 },
  { key: "fatherOrSpouseName", header: "Father / spouse name", width: 20 },
  { key: "category", header: "Category (GEN/OBC/SC/ST/EWS)", width: 12 },
  { key: "pan", header: "PAN", width: 13 },
  { key: "aadhaar", header: "Aadhaar", width: 15 },
  { key: "pran", header: "PRAN", width: 14 },
  { key: "uan", header: "UAN", width: 14 },
  { key: "esicNumber", header: "ESIC number", width: 13 },
  { key: "gpfNumber", header: "GPF number", width: 13 },
  { key: "bankAccount", header: "Bank account", width: 18 },
  { key: "ifsc", header: "IFSC", width: 13 },
  { key: "bankName", header: "Bank name", width: 18 },
];

export async function buildTemplate(actor: Actor): Promise<Buffer> {
  if (!canAll(actor, "employee_master", "create")) throw forbidden();
  const [sections, posts] = await Promise.all([
    db.section.findMany({ where: { boardId: actor.boardId, isActive: true }, orderBy: { code: "asc" } }),
    db.post.findMany({ where: { boardId: actor.boardId, isActive: true }, orderBy: { code: "asc" } }),
  ]);
  const wb = new ExcelJS.Workbook();
  wb.creator = "DCB HRMS";
  const sheet = wb.addWorksheet("Employees", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = BULK_COLUMNS.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: c.width }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF116541" } };
  sheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };
  sheet.getRow(1).height = 34;
  BULK_COLUMNS.forEach((c, i) => {
    if (c.note) sheet.getCell(1, i + 1).note = c.note;
    // Identity numbers and dates are typed as text so Excel does not turn them into numbers.
    sheet.getColumn(i + 1).numFmt = "@";
  });
  sheet.addRow({
    firstName: "Ramesh", lastName: "Kumar", gender: "M", dateOfBirth: "15-08-1990", dateOfJoining: "01-04-2015",
    type: "PERMANENT_NPS", sectionCode: sections[0]?.code ?? "ADM", postCode: posts[0]?.code ?? "LDC", payLevel: "2", payCell: "5", mobile: "9876543210",
  });
  sheet.getRow(2).font = { italic: true, color: { argb: "FF6B7A72" } };

  const lists = wb.addWorksheet("Codes");
  lists.columns = [
    { header: "Section code", key: "s", width: 14 },
    { header: "Section", key: "sn", width: 32 },
    { header: "", key: "gap", width: 3 },
    { header: "Post code", key: "p", width: 12 },
    { header: "Post", key: "pn", width: 32 },
    { header: "Level", key: "l", width: 8 },
  ];
  lists.getRow(1).font = { bold: true };
  const n = Math.max(sections.length, posts.length);
  for (let i = 0; i < n; i++) {
    lists.addRow({ s: sections[i]?.code, sn: sections[i]?.name, p: posts[i]?.code, pn: posts[i]?.name, l: posts[i]?.payLevel });
  }
  const help = wb.addWorksheet("How to fill");
  help.getColumn(1).width = 110;
  [
    "DCB HRMS — employee bulk upload (EM-10)",
    "",
    "1. Fill one row per person on the Employees sheet. Delete the grey example row.",
    "2. Columns marked * are required. Dates as DD-MM-YYYY.",
    "3. Permanent and deputation staff need Pay level and Cell. Contract and daily-wage workers need Wage rate and Wage paid.",
    "4. Use the codes on the Codes sheet for Section and Post.",
    "5. Upload the file. Every row is checked; nothing is saved until every row is correct.",
    "6. The batch then goes to a Checker. Employee IDs are issued when it is approved.",
  ].forEach((line, i) => {
    help.getCell(i + 1, 1).value = line;
    if (i === 0) help.getCell(1, 1).font = { bold: true, size: 14 };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return toISODate(value);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((r) => r.text).join("").trim();
  }
  return String(value).trim();
}

/** Accepts DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD and real Excel dates. */
export function parseSheetDate(text: string): string | null {
  if (!text) return null;
  if (isISODate(text)) return text;
  const m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return "invalid";
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isISODate(iso) ? iso : "invalid";
}

export interface BulkRow {
  row: number;
  name: string;
  employeeCode: string | null;
  errors: string[];
  input?: unknown;
}

const msg = (key: string) => lookup(en, key) ?? key;

export async function checkBulkFile(actor: Actor, buffer: Buffer) {
  if (!canAll(actor, "employee_master", "create")) throw forbidden();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw badRequest("employees.errors.notExcel", { file: "employees.errors.notExcel" });
  }
  const sheet = wb.getWorksheet("Employees") ?? wb.worksheets[0];
  if (!sheet) throw badRequest("employees.errors.notExcel");
  const entries: { row: number; v: Record<string, string> }[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const v: Record<string, string> = {};
    BULK_COLUMNS.forEach((c, i) => (v[c.key] = cellText(row.getCell(i + 1).value)));
    if (!Object.values(v).some(Boolean)) return;
    if (v.firstName === "Ramesh" && v.lastName === "Kumar" && v.mobile === "9876543210") return; // the example row
    entries.push({ row: rowNumber, v });
  });
  return checkBulkValues(actor, entries);
}

/**
 * The EM-10 checks on rows already read (from the template, or mapped from the old system by the migration console):
 * codes, dates, the employee schema and cross-checks, duplicates within the batch and against people on the rolls.
 */
export async function checkBulkValues(actor: Actor, entries: { row: number; v: Record<string, string> }[]) {
  if (!canAll(actor, "employee_master", "create")) throw forbidden();
  return bulkChecks(actor.boardId, entries);
}

/** The checks alone, for callers that have checked access themselves (the migration console shows them to its Checker). */
export async function bulkChecks(boardId: string, entries: { row: number; v: Record<string, string> }[]) {
  const [sections, posts, codes] = await Promise.all([
    db.section.findMany({ where: { boardId } }),
    db.post.findMany({ where: { boardId } }),
    db.employee.findMany({ where: { boardId, employeeCode: { not: null } }, select: { employeeCode: true } }),
  ]);
  const sectionByCode = new Map(sections.map((s) => [s.code.toUpperCase(), s]));
  const postByCode = new Map(posts.map((p) => [p.code.toUpperCase(), p]));
  const existingCodes = new Set(codes.map((c) => c.employeeCode));
  const seen = { pan: new Map<string, number>(), aadhaar: new Map<string, number>(), bank: new Map<string, number>(), code: new Map<string, number>() };

  const rows: BulkRow[] = [];
  for (const { row: rowNumber, v: given } of entries) {
    const v: Record<string, string> = Object.fromEntries(BULK_COLUMNS.map((c) => [c.key, (given[c.key] ?? "").trim()]));
    const errors: string[] = [];
    const section = sectionByCode.get(v.sectionCode.toUpperCase());
    const post = postByCode.get(v.postCode.toUpperCase());
    if (!section) errors.push(`Section code: ${msg("employees.errors.unknownCode")} "${v.sectionCode}"`);
    if (!post) errors.push(`Post code: ${msg("employees.errors.unknownCode")} "${v.postCode}"`);
    const dates: Record<string, string | null> = {};
    for (const k of ["dateOfBirth", "dateOfJoining", "contractStart", "contractEnd"]) {
      dates[k] = parseSheetDate(v[k]);
      if (dates[k] === "invalid") errors.push(`${BULK_COLUMNS.find((c) => c.key === k)!.header}: ${msg("validation.date")}`);
    }
    const code = v.employeeCode ? v.employeeCode.toUpperCase() : null;
    if (code) {
      if (existingCodes.has(code)) errors.push(`Employee ID ${code}: ${msg("errors.duplicate").replace("{field}", "Employee ID")}`);
      if (seen.code.has(code)) errors.push(`Employee ID ${code}: ${msg("employees.errors.duplicateInFile")} (row ${seen.code.get(code)})`);
      seen.code.set(code, rowNumber);
    }
    const input = {
      personal: {
        firstName: v.firstName,
        middleName: v.middleName,
        lastName: v.lastName,
        nameHi: v.nameHi,
        gender: v.gender.toUpperCase(),
        dateOfBirth: dates.dateOfBirth ?? "",
        fatherOrSpouseName: v.fatherOrSpouseName,
        category: v.category.toUpperCase(),
        isDisabled: false,
        mobile: v.mobile,
        email: v.email,
      },
      job: {
        type: v.type.toUpperCase(),
        sectionId: section?.id ?? "",
        postId: post?.id ?? "",
        dateOfJoining: dates.dateOfJoining ?? "",
        payLevel: v.payLevel,
        payCell: v.payCell,
        wageRate: v.wageRate,
        wageBasis: v.wageBasis.toUpperCase(),
        contractStart: dates.contractStart === "invalid" ? null : dates.contractStart,
        contractEnd: dates.contractEnd === "invalid" ? null : dates.contractEnd,
      },
      ids: { pan: v.pan, aadhaar: v.aadhaar, pran: v.pran, uan: v.uan, esicNumber: v.esicNumber, gpfNumber: v.gpfNumber, bankAccount: v.bankAccount, ifsc: v.ifsc, bankName: v.bankName },
    };
    const parsed = createEmployeeSchema.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path.at(-1) ?? "");
        const label = BULK_COLUMNS.find((c) => c.key === field)?.header ?? field;
        const text = lookup(en, issue.message) ?? msg(issue.code === "invalid_type" || issue.code === "invalid_value" ? "validation.invalid" : "validation.invalid");
        errors.push(`${label}: ${text}`);
      }
    } else {
      for (const [k, m] of Object.entries(crossCheck(parsed.data.personal, parsed.data.job, parsed.data.ids))) {
        const field = k.split(".").pop()!;
        errors.push(`${BULK_COLUMNS.find((c) => c.key === field)?.header ?? field}: ${msg(m)}`);
      }
      const ids = parsed.data.ids;
      for (const [kind, value] of [["pan", ids.pan], ["aadhaar", ids.aadhaar], ["bank", ids.bankAccount]] as const) {
        if (!value) continue;
        const prev = seen[kind].get(value);
        if (prev) errors.push(`${kind === "bank" ? "Bank account" : kind.toUpperCase()}: ${msg("employees.errors.duplicateInFile")} (row ${prev})`);
        seen[kind].set(value, rowNumber);
      }
    }
    rows.push({ row: rowNumber, name: [v.firstName, v.lastName].filter(Boolean).join(" ") || "—", employeeCode: code, errors, input: parsed.success ? parsed.data : undefined });
  }

  // Duplicates against people already on the rolls.
  const hashes = { pan: [...seen.pan.keys()].map((x) => blindIndex("pan", x)), aadhaar: [...seen.aadhaar.keys()].map((x) => blindIndex("aadhaar", x)), bank: [...seen.bank.keys()].map((x) => blindIndex("bank", x)) };
  const clashes = await db.employee.findMany({
    where: {
      boardId,
      status: { in: [...ACTIVE_STATUSES] },
      OR: [{ panHash: { in: hashes.pan } }, { aadhaarHash: { in: hashes.aadhaar } }, { bankAccountHash: { in: hashes.bank } }],
    },
    select: { panHash: true, aadhaarHash: true, bankAccountHash: true, employeeCode: true },
  });
  if (clashes.length) {
    for (const r of rows) {
      const ids = (r.input as { ids?: { pan?: string | null; aadhaar?: string | null; bankAccount?: string | null } } | undefined)?.ids;
      if (!ids) continue;
      for (const c of clashes) {
        if (ids.pan && c.panHash === blindIndex("pan", ids.pan)) r.errors.push(`PAN: ${msg("employees.errors.duplicateId")} (${c.employeeCode})`);
        if (ids.aadhaar && c.aadhaarHash === blindIndex("aadhaar", ids.aadhaar)) r.errors.push(`Aadhaar: ${msg("employees.errors.duplicateId")} (${c.employeeCode})`);
        if (ids.bankAccount && c.bankAccountHash === blindIndex("bank", ids.bankAccount)) r.errors.push(`Bank account: ${msg("employees.errors.duplicateId")} (${c.employeeCode})`);
      }
    }
  }
  return rows;
}

/** Saves a fully valid file as drafts and sends the whole batch to a Checker. */
export async function submitBulk(actor: Actor, buffer: Buffer, fileName: string) {
  const rows = await checkBulkFile(actor, buffer);
  if (!rows.length) throw badRequest("employees.errors.notExcel");
  if (rows.some((r) => r.errors.length)) throw badRequest("employees.bulk.fixAndRetry");
  return submitBulkRows(actor, rows, fileName);
}

/** Checked rows saved as drafts, sent to a Checker as one batch; approval issues every Employee ID. */
export async function submitBulkRows(actor: Actor, rows: BulkRow[], fileName: string, opts: { source?: "migration" } = {}) {
  if (!rows.length || rows.some((r) => r.errors.length || !r.input)) throw badRequest("employees.bulk.fixAndRetry");
  return db.$transaction(
    async (tx) => {
      const ids: string[] = [];
      for (const r of rows) {
        const e = await createEmployee(actor, r.input, { tx, skipApproval: true, employeeCode: r.employeeCode });
        ids.push(e.id);
      }
      const task = await submitForApproval(tx, actor, {
        kind: "employee.bulk_create",
        title: `Bulk upload: ${ids.length} employees (${fileName})`,
        titleHi: `थोक अपलोड: ${ids.length} कर्मचारी (${fileName})`,
        details: {
          summary: "Open the employee list (status: waiting for check) to look at the records. Approving issues Employee IDs to all of them.",
          summaryHi: "रिकॉर्ड देखने के लिए कर्मचारी सूची (स्थिति: जाँच के लिए लंबित) खोलें। स्वीकृति पर सभी को कर्मचारी आईडी मिलेगी।",
          link: "/employees?status=DRAFT",
          ...(opts.source ? { source: opts.source } : {}),
          rows: rows.slice(0, 50).map((r) => ({ label: `Row ${r.row}`, new: `${r.name}${r.employeeCode ? ` (${r.employeeCode})` : ""}` })),
        },
        payload: { employeeIds: ids },
        entityType: "EmployeeBatch",
        entityId: ids[0],
      });
      await audit(tx, actor, { action: "UPLOAD", entityType: "EmployeeBatch", entityId: task.id, summary: `Bulk upload of ${ids.length} employees from ${fileName}` });
      return { count: ids.length, taskId: task.id };
    },
    { timeout: 120_000 },
  );
}
