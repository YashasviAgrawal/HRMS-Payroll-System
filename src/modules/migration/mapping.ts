import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { audit, diff } from "@/lib/audit";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isISODate } from "@/lib/dates";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { allowedLists, fieldsFor, mappingOf } from "./build";
import { looksLikeKruti } from "./krutidev";
import { assertOpen, canSeeMigration, canWorkMigration, stagedTables } from "./staging";
import { cellOf, TARGET_DEFS, TARGETS, type CodeList, type Codes, type Fields, type Options, type TargetKey } from "./targets";

/**
 * §15 step 4 (map) and step 5 (clean): the mapping sheet of each target, signed off by Accounts, and the staged values
 * cleaned one by one. The original value always stays in the staged row; a change to a mapping clears its sign-off.
 */

/** HR maps employees and leave, Payroll the money, Pension the pensioners (§14: HR & Accounts create). */
export function canMapTarget(actor: Actor, target: TargetKey) {
  return canWorkMigration(actor) && actor.permissions.includes(TARGET_DEFS[target].owner);
}

/** Accounts (Payroll) signs the mapping sheet off. */
export const canSignMapping = (actor: Actor) => canWorkMigration(actor) && actor.permissions.includes("PAYROLL");

export function parseTarget(raw: string): TargetKey {
  if (!(TARGETS as readonly string[]).includes(raw)) throw notFound();
  return raw as TargetKey;
}

// Column names FoxPro payroll programs commonly use, to fill the sheet in for a first look (always checked by a person).
const SYNONYMS: Record<string, string[]> = {
  employeeCode: ["EMPCODE", "EMP_CODE", "EMPNO", "EMP_NO", "ECODE", "CODE", "EMPID", "EMP_ID", "STAFFNO", "PFNO", "TOKEN"],
  fullName: ["NAME", "EMPNAME", "EMP_NAME", "ENAME", "FULLNAME"],
  firstName: ["FNAME", "FIRSTNAME", "FIRST_NAME"],
  middleName: ["MNAME", "MIDDLENAME", "MIDDLE_NAME"],
  lastName: ["LNAME", "LASTNAME", "LAST_NAME", "SURNAME"],
  nameHi: ["HNAME", "HINDINAME", "NAMEHINDI", "NAME_H", "HNDNAME"],
  gender: ["SEX", "GENDER"],
  dateOfBirth: ["DOB", "BIRTHDATE", "DT_BIRTH", "DATEBIRTH", "D_O_B"],
  dateOfJoining: ["DOJ", "JOINDATE", "DT_JOIN", "DATEJOIN", "D_O_J", "DOA"],
  type: ["TYPE", "EMPTYPE", "CATG", "STATUS_TYP"],
  sectionCode: ["SECTION", "SECT", "DEPT", "DEPTCODE", "BRANCH", "OFFICE"],
  postCode: ["POST", "DESIG", "DESIGNATN", "DESIGCODE", "POSTCODE"],
  payLevel: ["LEVEL", "PAYLEVEL", "PAY_LEVEL", "LVL"],
  payCell: ["CELL", "PAYCELL", "INDEX"],
  mobile: ["MOBILE", "MOB", "PHONE", "CELLNO"],
  fatherOrSpouseName: ["FATHER", "FNAME_F", "FATHERNAME", "HUSBAND"],
  category: ["CASTE", "CATEGORY", "CAT"],
  pan: ["PAN", "PANNO", "PAN_NO"],
  aadhaar: ["AADHAR", "AADHAAR", "UID", "ADHAR"],
  pran: ["PRAN", "PRANNO"],
  uan: ["UAN", "UANNO"],
  esicNumber: ["ESIC", "ESICNO", "ESI_NO", "IPNO"],
  gpfNumber: ["GPFNO", "GPF_NO", "GPFACNO"],
  bankAccount: ["ACNO", "BANKAC", "ACCOUNT", "AC_NO", "BANKACNO", "SBACNO"],
  ifsc: ["IFSC", "IFSCODE", "IFSC_CODE"],
  bankName: ["BANK", "BANKNAME"],
  balance: ["BALANCE", "CLBAL", "CL_BAL", "CLOSING", "GPFBAL", "BAL"],
  loanType: ["LOANTYPE", "LTYPE", "ADVTYPE", "LOAN"],
  principalLeft: ["BALANCE", "BALAMT", "OUTSTAND", "PRIN_BAL"],
  interestLeft: ["INTBAL", "INT_BAL", "INTEREST"],
  instalment: ["INSTAL", "INSTALMENT", "EMI", "INSTAMT", "DEDN"],
  interestRate: ["RATE", "INTRATE", "ROI"],
  sanctionDate: ["SANCDATE", "SANC_DT", "DATE"],
  orderNumber: ["ORDERNO", "SANCNO", "ORDER"],
  salary: ["GROSS", "SALARY", "TOTSAL", "TAXABLE"],
  tds: ["TDS", "ITAX", "INCOMETAX", "IT"],
  ppoNumber: ["PPO", "PPONO", "PPO_NO"],
  payeeName: ["NAME", "PNAME", "PENSIONER"],
  payeeNameHi: ["HNAME", "HINDINAME"],
  payeeDob: ["DOB", "PDOB"],
  dateOfJoiningP: ["DOJ"],
  retirementDate: ["DOR", "RETDATE", "DT_RETIRE"],
  basicPension: ["PENSION", "BASICPEN", "BASIC_PEN", "BPENSION"],
  commutedAmount: ["COMMUTED", "COMMUTE", "COMM_AMT"],
  commutationDate: ["COMMDATE", "COMM_DT"],
  startDate: ["PENFROM", "PEN_FROM", "STARTDATE"],
  lastCertificate: ["LIFECERT", "LC_DATE", "LCDATE"],
  lastBasicPaid: ["PENSION", "BASICPEN"],
  lastDrPaid: ["DR", "DEARNESS", "DRAMT"],
  month: ["MONTH", "MON", "PAYMONTH", "SALMONTH", "YYMM"],
  gross: ["GROSS", "TOTEARN", "GROSSPAY"],
  deductions: ["TOTDED", "DEDUCTION", "DEDN", "TOTALDED"],
  net: ["NET", "NETPAY", "NET_PAY"],
  head: ["PAYCODE", "HEAD", "CODE", "ITEM"],
  amount: ["AMOUNT", "AMT"],
};

function suggestColumn(field: string, columns: string[], taken: Set<string>) {
  const want = SYNONYMS[field] ?? [];
  const upper = columns.map((c) => c.toUpperCase());
  for (const w of want) {
    const i = upper.indexOf(w);
    if (i >= 0 && !taken.has(columns[i])) return columns[i];
  }
  return null;
}

/** The mapping screen of one target: the sheet (or a first suggestion), the staged tables, code lists and sign-off. */
export async function mappingScreen(actor: Actor, target: TargetKey, fileParam?: string) {
  if (!canSeeMigration(actor)) throw forbidden();
  const [mapping, tables, fields, lists] = await Promise.all([mappingOf(actor.boardId, target), stagedTables(actor.boardId), fieldsFor(actor.boardId, target), allowedLists(actor.boardId)]);
  const fileId = fileParam && tables.some((t) => t.id === fileParam) ? fileParam : (mapping?.fileId ?? null);
  const file = tables.find((t) => t.id === fileId) ?? null;
  const columns = ((file?.columns as { name: string }[] | null) ?? []).map((c) => c.name);
  let map = ((mapping?.fields ?? {}) as unknown as Fields) ?? {};
  // A new table (or no sheet yet): suggest columns by name, and Kruti Dev for Hindi names that look like it.
  if (file && (!mapping || mapping.fileId !== file.id)) {
    const taken = new Set<string>();
    const sample = await db.migrationRow.findMany({ where: { fileId: file.id, deleted: false }, take: 20, orderBy: { rowNo: "asc" } });
    map = {};
    for (const f of fields) {
      const col = suggestColumn(f.key, columns, taken) ?? (columns.find((c) => c.toUpperCase() === f.key.toUpperCase()) ?? null);
      if (!col) continue;
      taken.add(col);
      const kruti = f.hindi && sample.some((r) => looksLikeKruti(String((r.data as Record<string, unknown>)[col] ?? "")));
      map[f.key] = { column: col, transform: kruti ? "kruti" : "none" };
    }
  }
  return {
    target,
    def: TARGET_DEFS[target],
    fields,
    tables: tables.map((t) => ({ id: t.id, tableName: t.tableName, fileName: t.fileName, liveCount: t.liveCount })),
    file: file ? { id: file.id, tableName: file.tableName, fileName: file.fileName, columns } : null,
    map,
    codes: ((mapping?.codes ?? {}) as unknown as Codes) ?? {},
    options: ((mapping?.options ?? {}) as unknown as Options) ?? {},
    lists,
    saved: Boolean(mapping && mapping.fileId === fileId),
    signed: mapping?.signedAt ? { byName: mapping.signedByName, at: mapping.signedAt.toISOString() } : null,
    canEdit: canMapTarget(actor, target),
    canSign: canSignMapping(actor) && Boolean(mapping?.fileId) && !mapping?.signedAt,
  };
}

/** Distinct values of the column a code-list field reads, so each can be given its value here. */
export async function codeValues(actor: Actor, target: TargetKey, field: string, column: string, fileId: string) {
  if (!canSeeMigration(actor)) throw forbidden();
  const fields = await fieldsFor(actor.boardId, target);
  const def = fields.find((f) => f.key === field);
  if (!def?.list) throw notFound();
  const file = await db.migrationFile.findFirst({ where: { id: fileId, boardId: actor.boardId } });
  if (!file) throw notFound();
  const rows = await db.migrationRow.findMany({ where: { fileId, deleted: false }, select: { data: true, fixed: true } });
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = cellOf({ data: r.data as Record<string, string>, fixed: r.fixed as Record<string, string> | null }, column);
    if (v === null || v === undefined || String(v).trim() === "") continue;
    const s = String(v).trim();
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 300).map(([value, rowsWith]) => ({ value, rows: rowsWith }));
}

const fieldMap = z.object({ column: z.string().max(64).nullable(), transform: z.enum(["none", "kruti", "upper"]).optional(), constant: z.string().max(100).nullable().optional() });
const saveSchema = z.object({
  fileId: z.string().min(1),
  fields: z.record(z.string().max(40), fieldMap),
  codes: z.record(z.string().max(20), z.record(z.string().max(100), z.string().max(40))).default({}),
  options: z
    .object({
      asOn: z.string().refine(isISODate, "validation.date").optional(),
      fy: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      filterColumn: z.string().max(64).optional(),
      filterValues: z.string().max(300).optional(),
      sectionCode: z.string().max(20).optional(),
      postCode: z.string().max(20).optional(),
      layout: z.enum(["long", "wide"]).optional(),
      control: z.record(z.string().regex(/^\d{4}-\d{2}$/), z.object({ gross: z.coerce.number(), deductions: z.coerce.number(), net: z.coerce.number() })).optional(),
    })
    .default({}),
});

export async function saveMapping(actor: Actor, target: TargetKey, raw: unknown) {
  if (!canMapTarget(actor, target)) throw forbidden();
  await assertOpen(actor);
  const input = saveSchema.parse(raw);
  const file = await db.migrationFile.findFirst({ where: { id: input.fileId, boardId: actor.boardId, kind: { in: ["DBF", "CSV", "XLSX"] } } });
  if (!file) throw badRequest("errors.validation", { fileId: "migration.errors.noTable" });
  const columns = new Set(((file.columns as { name: string }[] | null) ?? []).map((c) => c.name));
  const fields = await fieldsFor(actor.boardId, target);
  const known = new Set(fields.map((f) => f.key));
  for (const [k, m] of Object.entries(input.fields)) {
    if (!known.has(k)) throw badRequest("errors.validation", { [k]: "validation.invalid" });
    if (m.column && !columns.has(m.column)) throw badRequest("errors.validation", { [k]: "migration.errors.noColumn" });
  }
  if (input.options.filterColumn && !columns.has(input.options.filterColumn)) throw badRequest("errors.validation", { filterColumn: "migration.errors.noColumn" });
  if (TARGET_DEFS[target].options.includes("asOn") && !input.options.asOn) throw badRequest("errors.validation", { asOn: "validation.required" });
  const lists = await allowedLists(actor.boardId);
  for (const [list, pairs] of Object.entries(input.codes)) {
    const allowed = lists[list as CodeList];
    if (!allowed) throw badRequest("errors.validation", { codes: "validation.invalid" });
    for (const v of Object.values(pairs)) if (v && !allowed.includes(v)) throw badRequest("errors.validation", { [list]: "validation.invalid" });
  }
  const codes = Object.fromEntries(Object.entries(input.codes).map(([k, pairs]) => [k, Object.fromEntries(Object.entries(pairs).filter(([, v]) => v))]));
  return db.$transaction(async (tx) => {
    const before = await tx.migrationMapping.findUnique({ where: { boardId_target: { boardId: actor.boardId, target } } });
    const data = { fileId: file.id, fields: input.fields as Prisma.InputJsonValue, codes: codes as Prisma.InputJsonValue, options: input.options as Prisma.InputJsonValue, updatedById: actor.userId };
    const changed = !before || JSON.stringify([before.fileId, before.fields, before.codes, before.options]) !== JSON.stringify([data.fileId, data.fields, data.codes, data.options]);
    const row = await tx.migrationMapping.upsert({
      where: { boardId_target: { boardId: actor.boardId, target } },
      create: { boardId: actor.boardId, target, ...data },
      // Any change clears Accounts' sign-off.
      update: { ...data, ...(changed ? { signedById: null, signedByName: null, signedAt: null } : {}) },
    });
    if (changed) {
      await audit(tx, actor, {
        action: before ? "UPDATE" : "CREATE",
        entityType: "MigrationMapping",
        entityId: row.id,
        summary: `Mapping sheet for ${target} from ${file.tableName}${before?.signedAt ? " (sign-off cleared)" : ""}`,
        ...diff((before ?? {}) as Record<string, unknown>, data as Record<string, unknown>),
      });
    }
    return row;
  });
}

/** Accounts signs the sheet off (§15 step 4). */
export async function signMapping(actor: Actor, target: TargetKey) {
  if (!canSignMapping(actor)) throw forbidden();
  await assertOpen(actor);
  const m = await mappingOf(actor.boardId, target);
  if (!m?.fileId) throw badRequest("migration.errors.notMapped");
  if (m.signedAt) return m;
  return db.$transaction(async (tx) => {
    const row = await tx.migrationMapping.update({ where: { id: m.id }, data: { signedById: actor.userId, signedByName: actor.name, signedAt: new Date() } });
    await audit(tx, actor, { action: "APPROVE", entityType: "MigrationMapping", entityId: m.id, summary: `Signed off the mapping sheet for ${target} (Accounts)` });
    return row;
  });
}

const fixSchema = z.object({ column: z.string().min(1).max(64), value: z.string().max(500).nullable() });

/** §15 step 5: one staged value cleaned (null puts the original back). */
export async function fixCell(actor: Actor, rowId: string, raw: unknown) {
  if (!canWorkMigration(actor)) throw forbidden();
  await assertOpen(actor);
  const input = fixSchema.parse(raw);
  const row = await db.migrationRow.findFirst({ where: { id: rowId, file: { boardId: actor.boardId } }, include: { file: true } });
  if (!row) throw notFound();
  const columns = ((row.file.columns as { name: string }[] | null) ?? []).map((c) => c.name);
  if (!columns.includes(input.column)) throw badRequest("errors.validation", { column: "migration.errors.noColumn" });
  const fixed = { ...((row.fixed as Record<string, unknown> | null) ?? {}) };
  const before = Object.prototype.hasOwnProperty.call(fixed, input.column) ? fixed[input.column] : (row.data as Record<string, unknown>)[input.column];
  if (input.value === null) delete fixed[input.column];
  else fixed[input.column] = input.value;
  await db.$transaction(async (tx) => {
    await tx.migrationRow.update({ where: { id: row.id }, data: { fixed: Object.keys(fixed).length ? (fixed as Prisma.InputJsonValue) : Prisma.DbNull, fixedById: actor.userId, fixedAt: new Date() } });
    await audit(tx, actor, {
      action: "UPDATE",
      entityType: "MigrationRow",
      entityId: row.id,
      summary: `Cleaned ${row.file.tableName} row ${row.rowNo}, ${input.column}`,
      oldValue: { [input.column]: before ?? null },
      newValue: { [input.column]: input.value ?? (row.data as Record<string, unknown>)[input.column] ?? null },
      sensitive: true,
    });
  });
  return { ok: true };
}

const explainSchema = z.object({ key: z.string().min(5).max(200), note: z.string().trim().max(500).nullable() });

/** §15 "Exceptions": an issue explained in writing (an empty note takes the explanation back). */
export async function explainIssue(actor: Actor, raw: unknown) {
  if (!canWorkMigration(actor)) throw forbidden();
  await assertOpen(actor);
  const input = explainSchema.parse(raw);
  const target = parseTarget(input.key.split(":")[0]);
  if (input.note !== null && input.note.length < 5) throw badRequest("errors.validation", { note: "validation.tooShort" });
  await db.$transaction(async (tx) => {
    if (input.note) {
      await tx.migrationNote.upsert({ where: { boardId_key: { boardId: actor.boardId, key: input.key } }, create: { boardId: actor.boardId, key: input.key, note: input.note, byId: actor.userId, byName: actor.name }, update: { note: input.note, byId: actor.userId, byName: actor.name } });
    } else await tx.migrationNote.deleteMany({ where: { boardId: actor.boardId, key: input.key } });
    await audit(tx, actor, { action: input.note ? "EXPLAIN" : "UPDATE", entityType: "MigrationNote", entityId: input.key, summary: input.note ? `Explained a ${target} exception: ${input.note}` : `Took back the explanation of a ${target} exception` });
  });
  return { ok: true };
}
