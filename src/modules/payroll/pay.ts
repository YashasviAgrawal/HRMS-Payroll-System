import "server-only";
import ExcelJS from "exceljs";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { decrypt } from "@/lib/crypto";
import { parseCsv, toCsv } from "@/lib/csv";
import { db, type Tx } from "@/lib/db";
import { formatMonth, todayIST } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { createOutgoingFile } from "@/lib/files";
import { onFileReleased } from "@/lib/files-hooks";
import { formatINR } from "@/lib/money";
import { emit } from "@/lib/outbox";
import { saveFile, sniff } from "@/lib/storage";
import { fullName } from "@/modules/employees/present";
import { getSetting } from "@/modules/settings/service";
import { buildBankFile, parseReturnRows, type BankRow } from "./bank-formats";
import type { PayLine } from "./engine";
import { runTitle, type RunGroup } from "./compute";

/**
 * Stage 5 of S-40 — Pay (PRD §8 flow steps 6–7): the bank file goes through the file registry (preview → an Admin
 * releases it → download), the bank's return file marks failed credits, failed credits are re-paid in a new bank
 * file, and the month is closed with the accounting summary for e-Chhawani (PR-14).
 */

const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const mask = (account: string) => `••••${account.slice(-4)}`;

function assertPayroll(actor: Actor) {
  if (!canAll(actor, "payroll", "create")) throw forbidden();
}

async function loadRun(actor: Actor, runId: string, tx: Tx | typeof db = db) {
  const run = await tx.payrollRun.findFirst({ where: { id: runId, boardId: actor.boardId } });
  if (!run) throw notFound();
  return run;
}

/** Bank rows for the given payslips, from the bank details on the record now (an approved change counts). */
async function bankRows(slipIds: string[], month: string, tx: Tx | typeof db = db): Promise<BankRow[]> {
  const slips = await tx.payslip.findMany({
    where: { id: { in: slipIds } },
    include: { employee: { select: { employeeCode: true, firstName: true, middleName: true, lastName: true, bankAccountEnc: true, ifsc: true } } },
  });
  const rows: BankRow[] = [];
  for (const s of slips.sort((a, b) => (a.employee.employeeCode ?? "").localeCompare(b.employee.employeeCode ?? ""))) {
    const code = s.employee.employeeCode ?? "";
    if (!s.employee.bankAccountEnc || !s.employee.ifsc) throw badRequest("payroll.errors.noBankFor", undefined, { code });
    rows.push({
      employeeCode: code,
      name: fullName(s.employee),
      account: decrypt(s.employee.bankAccountEnc),
      ifsc: s.employee.ifsc,
      amount: num(s.net),
      narration: `DCB SALARY ${month.replace("-", "")} ${code}`,
    });
  }
  return rows;
}

async function bankFileFor(actor: Actor, tx: Tx, run: { id: string; month: string; payGroup: string }, rows: BankRow[], kind: "bank.salary" | "bank.repay") {
  const bank = await getSetting(actor.boardId, "bank", tx);
  const out = buildBankFile(bank.format, rows, { debitIfsc: bank.ifsc, valueDate: todayIST() });
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const repay = kind === "bank.repay";
  const title = runTitle(run.payGroup as RunGroup, run.month);
  return createOutgoingFile(
    actor,
    {
      kind,
      period: run.month,
      fileName: `${repay ? "repay" : "salary"}-${run.month}-${run.payGroup.toLowerCase()}${repay ? `-${Date.now().toString(36)}` : ""}.${out.ext}`,
      ext: out.ext,
      mimeType: out.mimeType,
      buffer: Buffer.from(out.content, "utf8"),
      preview: {
        columns: ["Employee ID", "Name", "Account", "IFSC", "Amount"],
        rows: rows.slice(0, 25).map((r) => [r.employeeCode, r.name, mask(r.account), r.ifsc, r.amount.toFixed(2)]),
        totalRows: rows.length,
        totals: { "Total amount": formatINR(total, { decimals: true }), Format: bank.format },
      },
      title: `${repay ? "Re-pay bank file" : "Bank file"}: ${title} — ${rows.length} credits, ${formatINR(total)}`,
      titleHi: `${repay ? "पुनः भुगतान बैंक फ़ाइल" : "बैंक फ़ाइल"}: ${runTitle(run.payGroup as RunGroup, run.month, "hi")} — ${rows.length} भुगतान, ${formatINR(total)}`,
      link: `/payroll/${run.id}`,
    },
    tx,
  );
}

/** PR-12: the salary bank file for everyone paid in the run. */
export async function buildSalaryBankFile(actor: Actor, runId: string) {
  assertPayroll(actor);
  return db.$transaction(async (tx) => {
    const run = await loadRun(actor, runId, tx);
    if (run.status !== "APPROVED") throw conflict("payroll.errors.wrongStage");
    if (run.bankFileId) {
      const existing = await tx.fileRecord.findUnique({ where: { id: run.bankFileId } });
      if (existing && existing.status !== "REJECTED") throw conflict("payroll.errors.bankFileExists");
    }
    const slips = await tx.payslip.findMany({ where: { runId, status: "INCLUDED", net: { gt: 0 } }, select: { id: true } });
    const rows = await bankRows(slips.map((s) => s.id), run.month, tx);
    const file = await bankFileFor(actor, tx, run, rows, "bank.salary");
    await tx.payrollRun.update({ where: { id: runId }, data: { bankFileId: file.id } });
    return file;
  });
}

/** The bank's return file: every credit not listed as failed is marked credited. */
export async function importReturnFile(actor: Actor, runId: string, buffer: Buffer, fileName: string) {
  assertPayroll(actor);
  const run = await loadRun(actor, runId);
  if (run.status !== "PAID" || run.returnAt) throw conflict("payroll.errors.wrongStage");
  const table = await readTable(buffer);
  const parsed = parseReturnRows(table);
  if (parsed.errors.length) throw badRequest("payroll.errors.returnFile", undefined, { lines: parsed.errors.map((e) => e.line).join(", ") });
  const slips = await db.payslip.findMany({ where: { runId, status: "INCLUDED" }, include: { employee: { select: { employeeCode: true } } } });
  const byCode = new Map(slips.map((s) => [s.employee.employeeCode, s]));
  const bad = parsed.rows.filter((r) => {
    const s = byCode.get(r.employeeCode);
    return !s || Math.abs(num(s.net) - r.amount) > 0.5;
  });
  if (bad.length) throw badRequest("payroll.errors.returnMismatch", undefined, { lines: bad.map((r) => r.line).join(", ") });
  const stored = await saveFile("files", buffer, sniff(buffer) === "xlsx" ? "xlsx" : "csv");
  const failed = parsed.rows.filter((r) => r.failed);
  return db.$transaction(async (tx) => {
    const fresh = await loadRun(actor, runId, tx);
    if (fresh.status !== "PAID" || fresh.returnAt) throw conflict("payroll.errors.wrongStage");
    await tx.payslip.updateMany({ where: { runId, status: "INCLUDED" }, data: { creditStatus: "CREDITED", creditNote: null } });
    for (const r of failed) {
      await tx.payslip.update({ where: { id: byCode.get(r.employeeCode)!.id }, data: { creditStatus: "FAILED", creditNote: r.reason || null } });
    }
    await tx.fileRecord.create({
      data: {
        boardId: actor.boardId,
        direction: "INCOMING",
        kind: "bank.return",
        period: run.month,
        fileName: fileName.slice(0, 200),
        mimeType: sniff(buffer) === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv",
        size: stored.size,
        sha256: stored.sha256,
        storageKey: stored.key,
        status: "VALIDATED",
        meta: { runId, failed: failed.length },
        createdById: actor.userId,
        createdByName: actor.name,
      },
    });
    await tx.payrollRun.update({ where: { id: runId }, data: { returnAt: new Date() } });
    await audit(tx, actor, { action: "IMPORT", entityType: "PayrollRun", entityId: runId, summary: `Read the bank return file ${fileName}: ${failed.length} failed credit(s)`, newValue: { failed: failed.map((r) => r.employeeCode), sha256: stored.sha256 } });
    return { failed: failed.length, credited: slips.length - failed.length };
  });
}

/** No return file from the bank — every credit went through. */
export async function markAllCredited(actor: Actor, runId: string) {
  assertPayroll(actor);
  return db.$transaction(async (tx) => {
    const run = await loadRun(actor, runId, tx);
    if (run.status !== "PAID" || run.returnAt) throw conflict("payroll.errors.wrongStage");
    const res = await tx.payslip.updateMany({ where: { runId, status: "INCLUDED" }, data: { creditStatus: "CREDITED" } });
    await tx.payrollRun.update({ where: { id: runId }, data: { returnAt: new Date() } });
    await audit(tx, actor, { action: "IMPORT", entityType: "PayrollRun", entityId: runId, summary: `Recorded that all ${res.count} credits went through` });
    return { failed: 0, credited: res.count };
  });
}

/** PR-12: a new bank file for failed credits (after the bank details are corrected through the Checker). */
export async function buildRepayFile(actor: Actor, runId: string) {
  assertPayroll(actor);
  return db.$transaction(async (tx) => {
    const run = await loadRun(actor, runId, tx);
    if (run.status !== "PAID") throw conflict("payroll.errors.wrongStage");
    const slips = await tx.payslip.findMany({ where: { runId, creditStatus: "FAILED", repayFileId: null }, select: { id: true } });
    if (!slips.length) throw badRequest("payroll.errors.nothingToRepay");
    const rows = await bankRows(slips.map((s) => s.id), run.month, tx);
    const file = await bankFileFor(actor, tx, run, rows, "bank.repay");
    await tx.payslip.updateMany({ where: { id: { in: slips.map((s) => s.id) } }, data: { repayFileId: file.id } });
    return file;
  });
}

/** PR-14: the month's pay charged to each account head — expenditure (debit) and recoveries and payables (credit). */
export async function accountingSummary(tx: Tx | typeof db, runId: string) {
  const slips = await tx.payslip.findMany({ where: { runId, status: "INCLUDED" }, select: { lines: true, net: true } });
  const heads = new Map<string, { accountHead: string; code: string; name: string; kind: string; amount: number }>();
  let net = 0;
  for (const s of slips) {
    net += num(s.net);
    for (const l of s.lines as unknown as PayLine[]) {
      const h = heads.get(l.code) ?? { accountHead: l.accountHead, code: l.code, name: l.name, kind: l.kind, amount: 0 };
      h.amount += l.amount;
      heads.set(l.code, h);
    }
  }
  const rows: { accountHead: string; code: string; name: string; debit: number; credit: number }[] = [];
  const list = [...heads.values()];
  for (const h of list.filter((x) => x.kind === "EARNING")) rows.push({ accountHead: h.accountHead, code: h.code, name: h.name, debit: h.amount, credit: 0 });
  for (const h of list.filter((x) => x.kind === "EMPLOYER")) rows.push({ accountHead: h.accountHead, code: h.code, name: h.name, debit: h.amount, credit: 0 });
  for (const h of list.filter((x) => x.kind === "DEDUCTION")) rows.push({ accountHead: h.accountHead, code: h.code, name: h.name, debit: 0, credit: h.amount });
  const employer = list.filter((x) => x.kind === "EMPLOYER").reduce((s, h) => s + h.amount, 0);
  if (employer) rows.push({ accountHead: "L-2 Employer contributions payable", code: "ER_PAYABLE", name: "Employer contributions payable", debit: 0, credit: employer });
  rows.push({ accountHead: "L-1 Salary payable through bank", code: "NET", name: "Net pay credited to bank", debit: 0, credit: net });
  return rows;
}

/** Closes the month: every failed credit has a re-pay file; the accounting summary goes to the file registry. */
export async function closeRun(actor: Actor, runId: string) {
  assertPayroll(actor);
  return db.$transaction(async (tx) => {
    const run = await loadRun(actor, runId, tx);
    if (run.status !== "PAID" || !run.returnAt) throw conflict("payroll.errors.wrongStage");
    const failed = await tx.payslip.count({ where: { runId, creditStatus: "FAILED", repayFileId: null } });
    if (failed) throw badRequest("payroll.errors.failedOpen", undefined, { count: failed });
    const rows = await accountingSummary(tx, runId);
    const debit = rows.reduce((s, r) => s + r.debit, 0);
    const credit = rows.reduce((s, r) => s + r.credit, 0);
    const csv = toCsv(
      ["Month", "Pay group", "Account head", "Head code", "Head", "Debit", "Credit"],
      rows.map((r) => [run.month, run.payGroup, r.accountHead, r.code, r.name, r.debit ? r.debit.toFixed(2) : "", r.credit ? r.credit.toFixed(2) : ""]),
    );
    const file = await createOutgoingFile(
      actor,
      {
        kind: "accounts.summary",
        period: run.month,
        fileName: `accounts-${run.month}-${run.payGroup.toLowerCase()}.csv`,
        ext: "csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv, "utf8"),
        preview: {
          columns: ["Account head", "Head", "Debit", "Credit"],
          rows: rows.map((r) => [r.accountHead, r.name, r.debit ? r.debit.toFixed(2) : "", r.credit ? r.credit.toFixed(2) : ""]),
          totalRows: rows.length,
          totals: { Debit: formatINR(debit), Credit: formatINR(credit) },
        },
        title: `Accounting summary: ${runTitle(run.payGroup as RunGroup, run.month)}`,
        titleHi: `लेखा सारांश: ${runTitle(run.payGroup as RunGroup, run.month, "hi")}`,
        link: `/payroll/${run.id}`,
      },
      tx,
    );
    await tx.payrollRun.update({ where: { id: runId }, data: { status: "CLOSED", closedAt: new Date(), summaryFileId: file.id } });
    await audit(tx, actor, { action: "CLOSE", entityType: "PayrollRun", entityId: runId, summary: `Closed ${runTitle(run.payGroup as RunGroup, run.month)} (${formatMonth(run.month)})` });
    await emit(tx, actor.boardId, "payroll.closed", { type: "PayrollRun", id: runId }, { month: run.month, payGroup: run.payGroup });
    return file;
  });
}

/** The first sheet of an Excel file, or a CSV, as rows of text. */
async function readTable(buffer: Buffer): Promise<string[][]> {
  if (sniff(buffer) === "xlsx") {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw badRequest("employees.errors.notExcel");
    }
    const rows: string[][] = [];
    wb.worksheets[0]?.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= row.cellCount; c++) cells.push(String(row.getCell(c).text ?? ""));
      rows.push(cells);
    });
    return rows;
  }
  const text = buffer.toString("utf8");
  if (text.includes("\u0000")) throw badRequest("payroll.errors.returnFile", undefined, { lines: "1" });
  return parseCsv(text);
}

// ─── Release hooks: the Admin releasing a bank file ──────────────────────────

/** PR-13 boundary: once the salary bank file is released the payroll is paid and can no longer be reopened. */
onFileReleased("bank.salary", async (tx, file, actor) => {
  const run = await tx.payrollRun.findFirst({ where: { bankFileId: file.id } });
  if (!run || run.status !== "APPROVED") return;
  await tx.payrollRun.update({ where: { id: run.id }, data: { status: "PAID", paidAt: new Date() } });
  await audit(tx, actor, { action: "PAY", entityType: "PayrollRun", entityId: run.id, summary: `Bank file released — ${runTitle(run.payGroup as RunGroup, run.month)} is paid` });
  await emit(tx, run.boardId, "payroll.paid", { type: "PayrollRun", id: run.id }, { month: run.month, payGroup: run.payGroup });
});

onFileReleased("bank.repay", async (tx, file) => {
  await tx.payslip.updateMany({ where: { repayFileId: file.id, creditStatus: "FAILED" }, data: { creditStatus: "REPAID" } });
});
