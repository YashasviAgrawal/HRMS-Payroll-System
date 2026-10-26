import "server-only";
import ExcelJS from "exceljs";
import { submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDate, isISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden } from "@/lib/errors";
import { fullName } from "@/modules/employees/present";
import { parseDateText } from "@/modules/attendance/formats";
import { leaveRules } from "./balance";
import { hasBalance, isEligible } from "./rules";
import { openingSchema } from "./schema";
import { canEnterLeave } from "./service";

/** Leave columns in the opening sheet: credited leave as balances, service-limited leave as days used. */
async function openingCodes(boardId: string) {
  return (await leaveRules(boardId)).filter((t) => t.isActive && (hasBalance(t) || t.creditMode === "SERVICE") && !t.restrictedOnly);
}

/** LV-06 template: one row per person on the rolls, one column per leave. */
export async function openingTemplate(actor: Actor): Promise<Buffer> {
  if (!canEnterLeave(actor)) throw forbidden();
  const [codes, staff] = await Promise.all([
    openingCodes(actor.boardId),
    db.employee.findMany({ where: { boardId: actor.boardId, employeeCode: { not: null }, status: { in: ["ACTIVE", "SUSPENDED"] } }, orderBy: { employeeCode: "asc" }, select: { employeeCode: true, firstName: true, middleName: true, lastName: true } }),
  ]);
  const wb = new ExcelJS.Workbook();
  wb.creator = "DCB HRMS";
  const ws = wb.addWorksheet("Opening balances", { views: [{ state: "frozen", ySplit: 1, xSplit: 2 }] });
  ws.columns = [
    { header: "Employee ID", key: "code", width: 14 },
    { header: "Name", key: "name", width: 28 },
    ...codes.map((c) => ({ header: c.creditMode === "SERVICE" ? `${c.code} days used` : `${c.code} balance`, key: c.code, width: 14 })),
  ];
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF116541" } };
  for (const s of staff) ws.addRow({ code: s.employeeCode, name: fullName(s) });
  const help = wb.addWorksheet("How to fill");
  [
    "Opening leave balances (LV-06)",
    "Type the balance of each leave as on the cut-over date, from FoxPro or the paper leave account.",
    "Leave the cell empty when there is nothing to load. Half days are allowed (for example 12.5).",
    "For Child Care Leave, type the days already used in service, not a balance.",
    "Do not include the credit of the current half-year: the system credits it.",
  ].forEach((line, i) => {
    help.getCell(i + 1, 1).value = line;
    if (i === 0) help.getCell(1, 1).font = { bold: true, size: 14 };
  });
  help.getColumn(1).width = 100;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface OpeningRow {
  row: number;
  employeeId: string | null;
  code: string;
  name: string;
  values: Record<string, number>;
  errors: string[];
}

/** Reads the sheet and reports every problem, before anything is sent for checking. */
export async function readOpeningFile(actor: Actor, buffer: Buffer) {
  if (!canEnterLeave(actor)) throw forbidden();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw badRequest("employees.errors.notExcel", { file: "employees.errors.notExcel" });
  }
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest("employees.errors.notExcel", { file: "employees.errors.notExcel" });
  const codes = await openingCodes(actor.boardId);
  const heads = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? "").trim());
  const col = new Map<string, number>();
  for (const c of codes) {
    const i = heads.findIndex((h) => h.toUpperCase().startsWith(`${c.code} `) || h.toUpperCase() === c.code);
    if (i > 0) col.set(c.code, i);
  }
  const staff = await db.employee.findMany({ where: { boardId: actor.boardId, employeeCode: { not: null } }, select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, gender: true, type: true } });
  const byCode = new Map(staff.map((s) => [s.employeeCode!.toUpperCase(), s]));
  const rows: OpeningRow[] = [];
  const seen = new Set<string>();
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const code = String(row.getCell(1).text ?? "").trim().toUpperCase();
    if (!code) return;
    const e = byCode.get(code);
    const out: OpeningRow = { row: n, employeeId: e?.id ?? null, code, name: e ? fullName(e) : String(row.getCell(2).text ?? ""), values: {}, errors: [] };
    if (!e) out.errors.push("leave.opening.unknownEmployee");
    if (seen.has(code)) out.errors.push("leave.opening.duplicate");
    seen.add(code);
    for (const c of codes) {
      const i = col.get(c.code);
      if (!i) continue;
      const text = String(row.getCell(i).text ?? "").trim();
      if (text === "") continue;
      const v = Number(text);
      if (!Number.isFinite(v) || v < 0 || v > 1000 || Math.round(v * 2) !== v * 2) out.errors.push(`leave.opening.badNumber|${c.code}`);
      else if (e && !isEligible(c, e)) out.errors.push(`leave.opening.notEligible|${c.code}`);
      else if (c.cap !== null && v > c.cap) out.errors.push(`leave.opening.overCap|${c.code}`);
      else out.values[c.code] = v;
    }
    rows.push(out);
  });
  return { rows, codes: codes.map((c) => c.code) };
}

/** Sends the whole sheet to a Checker as one batch; nothing is loaded if any row has a problem. */
export async function submitOpeningFile(actor: Actor, buffer: Buffer, asOnText: string) {
  const asOn = isISODate(asOnText) ? asOnText : parseDateText(asOnText);
  if (!asOn) throw badRequest("errors.validation", { asOn: "validation.date" });
  const { rows } = await readOpeningFile(actor, buffer);
  if (rows.some((r) => r.errors.length)) throw badRequest("leave.opening.fixFirst");
  const flat = rows.flatMap((r) => Object.entries(r.values).map(([leaveCode, days]) => ({ employeeId: r.employeeId!, leaveCode, days })));
  return submitOpening(actor, { asOn, rows: flat, note: undefined }, rows.length);
}

/** LV-06 for one person or many: a Checker approves before the balances are loaded. */
export async function submitOpening(actor: Actor, raw: unknown, people?: number) {
  if (!canEnterLeave(actor)) throw forbidden();
  const input = openingSchema.parse(raw);
  const staff = await db.employee.findMany({ where: { boardId: actor.boardId, id: { in: [...new Set(input.rows.map((r) => r.employeeId))] } }, select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true } });
  if (staff.length !== new Set(input.rows.map((r) => r.employeeId)).size) throw badRequest("leave.opening.unknownEmployee");
  const names = new Map(staff.map((s) => [s.id, `${s.employeeCode} ${fullName(s)}`]));
  const count = people ?? staff.length;
  return db.$transaction(async (tx) => {
    const pending = await tx.approvalTask.findFirst({ where: { boardId: actor.boardId, kind: "leave.opening", status: "PENDING" } });
    if (pending) throw conflict("leave.opening.pending");
    const task = await submitForApproval(tx, actor, {
      kind: "leave.opening",
      title: `Opening leave balances as on ${formatDate(input.asOn)} (${count} ${count === 1 ? "person" : "people"})`,
      titleHi: `${formatDate(input.asOn, "hi")} तक का प्रारंभिक अवकाश शेष (${count} लोग)`,
      details: {
        rows: input.rows.slice(0, 200).map((r) => ({ label: `${names.get(r.employeeId)} · ${r.leaveCode}`, new: String(r.days) })),
        summary: input.rows.length > 200 ? `First 200 of ${input.rows.length} entries shown.` : `${input.rows.length} entries.`,
        link: "/leave/manage?tab=opening",
      } satisfies ApprovalDetails,
      payload: input,
      entityType: "LeaveOpening",
      entityId: input.asOn,
      note: input.note,
    });
    await audit(tx, actor, { action: "SUBMIT", entityType: "LeaveOpening", entityId: input.asOn, summary: `Sent opening leave balances for ${count} people for check` });
    return task;
  });
}
