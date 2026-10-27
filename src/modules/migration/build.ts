import "server-only";
import type { MigrationMapping } from "@/generated/prisma/client";
import type { Actor } from "@/lib/auth/session";
import { blindIndex } from "@/lib/crypto";
import { db } from "@/lib/db";
import { fromISODate, retirementDate, todayIST, toISODate } from "@/lib/dates";
import { isValidBankAccount, isValidIfsc, MOBILE_RE } from "@/lib/validators";
import { BULK_COLUMNS, bulkChecks, type BulkRow } from "@/modules/employees/bulk";
import { leaveRules } from "@/modules/leave/balance";
import { hasBalance, isEligible } from "@/modules/leave/rules";
import { currentFy } from "@/modules/statutory/tax";
import { FIXED_LISTS, keepRow, readField, splitName, TARGET_DEFS, type CodeList, type Codes, type FieldDef, type Fields, type Options, type TargetKey } from "./targets";

/**
 * §15 steps 4–6 and 8: a mapped staged table read into the records it will become, with every problem flagged — values
 * that cannot be read, codes not mapped, the EM-10 employee checks, duplicate identity numbers, people past retirement
 * still on the payroll. Each issue is fixed (the staged value cleaned) or explained in writing; rows already loaded
 * are counted, never loaded twice.
 */
export interface Issue {
  key: string;
  rowId: string;
  rowNo: number;
  code: string;
  field?: string;
  /** ERROR: the row cannot be loaded (fix it, or explain it to leave it out). FLAG: loads, but needs a fix or a reason. */
  level: "ERROR" | "FLAG";
  /** Text from the EM-10 checks, or the old value that could not be read. */
  detail?: string;
  who?: string;
  note?: { text: string; byName: string; at: string } | null;
}

export interface BuiltRecord {
  rowId: string;
  rowNo: number;
  who: string;
  values: Record<string, string | null>;
  employeeId?: string | null;
}

export interface Built {
  target: TargetKey;
  mapping: MigrationMapping | null;
  file: { id: string; tableName: string | null; fileName: string; liveCount: number } | null;
  fields: FieldDef[];
  records: BuiltRecord[];
  /** Every record read, loaded ones included (the §15 checks compare them with what was loaded). */
  all: BuiltRecord[];
  issues: Issue[];
  /** Rows the filter leaves out, and rows already loaded. */
  leftOut: number;
  loaded: number;
  /** Records that will be loaded: no open issue, and not an explained error. */
  ready: BuiltRecord[];
  open: number;
  bulk?: BulkRow[];
}

export async function mappingOf(boardId: string, target: TargetKey) {
  return db.migrationMapping.findUnique({ where: { boardId_target: { boardId, target } } });
}

/** Leave balances get a field per leave type that has a balance. */
export async function fieldsFor(boardId: string, target: TargetKey): Promise<FieldDef[]> {
  const base = TARGET_DEFS[target].fields;
  if (target !== "leave") return base;
  const rules = await leaveRules(boardId);
  return [...base, ...rules.filter((r) => r.isActive && hasBalance(r)).map((r) => ({ key: r.code, kind: "number" as const }))];
}

/** Allowed values of each code list: fixed lists, and the Board's sections, posts and pay heads. */
export async function allowedLists(boardId: string): Promise<Record<CodeList, string[]>> {
  const [sections, posts, heads] = await Promise.all([
    db.section.findMany({ where: { boardId, isActive: true }, select: { code: true }, orderBy: { code: "asc" } }),
    db.post.findMany({ where: { boardId, isActive: true }, select: { code: true }, orderBy: { code: "asc" } }),
    db.payHead.findMany({ where: { boardId }, select: { code: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
  ]);
  return {
    ...(Object.fromEntries(Object.entries(FIXED_LISTS).map(([k, v]) => [k, [...v]])) as Record<CodeList, string[]>),
    section: sections.map((s) => s.code),
    post: posts.map((p) => p.code),
    head: heads.map((h) => h.code),
  };
}

const keyOf = (target: TargetKey, fileId: string, rowNo: number, code: string, field?: string) => `${target}:${fileId}:${rowNo}:${code}:${field ?? ""}`;

export async function buildTarget(actor: Actor, target: TargetKey, opts: { fileId?: string } = {}): Promise<Built> {
  const boardId = actor.boardId;
  const mapping = await mappingOf(boardId, target);
  const fields = await fieldsFor(boardId, target);
  const fileId = opts.fileId ?? mapping?.fileId ?? null;
  const empty: Built = { target, mapping, file: null, fields, records: [], all: [], issues: [], leftOut: 0, loaded: 0, ready: [], open: 0 };
  if (!mapping || !fileId) return empty;
  const file = await db.migrationFile.findFirst({ where: { id: fileId, boardId } });
  if (!file) return empty;
  const map = (mapping.fields ?? {}) as unknown as Fields;
  const codes = (mapping.codes ?? {}) as unknown as Codes;
  const options = (mapping.options ?? {}) as unknown as Options;
  const lists = await allowedLists(boardId);
  const rows = await db.migrationRow.findMany({ where: { fileId, deleted: false }, orderBy: { rowNo: "asc" } });

  const records: BuiltRecord[] = [];
  const issues: Issue[] = [];
  let leftOut = 0;
  const add = (r: { id: string; rowNo: number }, code: string, level: Issue["level"], field?: string, detail?: string, who?: string) =>
    issues.push({ key: keyOf(target, fileId, r.rowNo, code, field), rowId: r.id, rowNo: r.rowNo, code, level, field, detail, who });

  for (const r of rows) {
    const row = { data: r.data as Record<string, string | number | boolean | null>, fixed: r.fixed as Record<string, string | number | boolean | null> | null };
    if (!keepRow(row, options)) {
      leftOut++;
      continue;
    }
    const values: Record<string, string | null> = {};
    for (const def of fields) {
      const got = readField(row, def, map[def.key], codes, def.list ? lists[def.list] : undefined);
      values[def.key] = got.value;
      if (got.error) add(r, got.error === "unmapped" ? "UNMAPPED" : got.error === "badDate" ? "BAD_DATE" : got.error === "badMonth" ? "BAD_MONTH" : "BAD_NUMBER", "ERROR", def.key, got.raw);
    }
    if (target === "employees" && values.fullName && !values.firstName) Object.assign(values, splitName(values.fullName));
    const who = [values.employeeCode ?? values.ppoNumber ?? "", values.firstName ? [values.firstName, values.lastName].filter(Boolean).join(" ") : values.payeeName ?? values.fullName ?? ""].filter(Boolean).join(" · ") || `#${r.rowNo}`;
    for (const def of fields) if (def.required && values[def.key] === null && !issues.some((i) => i.rowId === r.id && i.field === def.key)) add(r, "MISSING", "ERROR", def.key, undefined, who);
    if (target === "employees" && !values.firstName && !issues.some((i) => i.rowId === r.id && i.field === "firstName")) add(r, "MISSING", "ERROR", "firstName", undefined, who);
    for (const i of issues) if (i.rowId === r.id) i.who = who;
    records.push({ rowId: r.id, rowNo: r.rowNo, who, values });
  }

  // Target rules. Rows already loaded are taken out first, so loading again never doubles anything.
  const codesIn = [...new Set(records.map((x) => x.values.employeeCode?.toUpperCase()).filter((x): x is string => Boolean(x)))];
  const staff = codesIn.length
    ? await db.employee.findMany({ where: { boardId, employeeCode: { in: codesIn } }, select: { id: true, employeeCode: true, status: true, type: true, gender: true, dateOfBirth: true, postId: true } })
    : [];
  const staffBy = new Map(staff.map((s) => [s.employeeCode!.toUpperCase(), s]));
  const loadedRows = new Set<string>();
  const needStaff = (x: BuiltRecord, onRolls = false) => {
    const e = x.values.employeeCode ? staffBy.get(x.values.employeeCode.toUpperCase()) : undefined;
    if (!e) add({ id: x.rowId, rowNo: x.rowNo }, "UNKNOWN_EMPLOYEE", "ERROR", "employeeCode", x.values.employeeCode ?? "", x.who);
    else if (onRolls && !["ACTIVE", "SUSPENDED"].includes(e.status)) add({ id: x.rowId, rowNo: x.rowNo }, "NOT_ON_ROLLS", "ERROR", "employeeCode", e.status, x.who);
    x.employeeId = e?.id ?? null;
    return e;
  };
  const num = (v: string | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

  if (target === "employees") {
    for (const x of records) if (x.values.employeeCode && staffBy.has(x.values.employeeCode.toUpperCase())) loadedRows.add(x.rowId);
    const todo = records.filter((x) => !loadedRows.has(x.rowId));
    const posts = new Map((await db.post.findMany({ where: { boardId }, select: { code: true, retirementAge: true } })).map((p) => [p.code.toUpperCase(), p.retirementAge]));
    const bulk = await bulkChecks(
      boardId,
      todo.map((x) => ({ row: x.rowNo, v: Object.fromEntries(Object.entries(x.values).map(([k, v]) => [k, v ?? ""])) })),
    );
    const byRow = new Map(todo.map((x) => [x.rowNo, x]));
    for (const b of bulk) {
      const x = byRow.get(b.row)!;
      // Problems already flagged field by field are not repeated in the EM-10 wording.
      const flagged = new Set(issues.filter((i) => i.rowId === x.rowId).map((i) => i.field));
      for (const e of b.errors) {
        const label = e.split(":")[0].trim();
        const field = BULK_COLUMNS.find((c) => c.header === label || c.key === label)?.key;
        if (field && flagged.has(field)) continue;
        add({ id: x.rowId, rowNo: x.rowNo }, "EMPLOYEE_CHECK", "ERROR", field, e, x.who);
      }
      // §15 step 6: past the retirement age of the post and still on the payroll.
      const dob = x.values.dateOfBirth;
      const type = x.values.type ?? "";
      if (dob && !["CONTRACT", "DAILY_WAGE", "REEMPLOYED"].includes(type) && retirementDate(dob, posts.get((x.values.postCode ?? "").toUpperCase()) ?? 60) < todayIST()) add({ id: x.rowId, rowNo: x.rowNo }, "PAST_RETIREMENT", "FLAG", "dateOfBirth", retirementDate(dob, posts.get((x.values.postCode ?? "").toUpperCase()) ?? 60), x.who);
    }
    empty.bulk = bulk;
  }

  if (target === "leave") {
    const rules = new Map((await leaveRules(boardId)).map((r) => [r.code, r]));
    const opened = new Set((await db.leaveLedger.findMany({ where: { boardId, kind: "OPENING", employeeId: { in: staff.map((s) => s.id) } }, select: { employeeId: true } })).map((l) => l.employeeId));
    for (const x of records) {
      const e = needStaff(x);
      if (e && opened.has(e.id)) {
        loadedRows.add(x.rowId);
        continue;
      }
      for (const def of fields.slice(1)) {
        const v = x.values[def.key];
        if (v === null) continue;
        const n = Number(v);
        const rule = rules.get(def.key)!;
        if (n < 0 || n > 1000 || Math.round(n * 2) !== n * 2) add({ id: x.rowId, rowNo: x.rowNo }, "BAD_NUMBER", "ERROR", def.key, v, x.who);
        else if (e && !isEligible(rule, { gender: e.gender, type: e.type })) add({ id: x.rowId, rowNo: x.rowNo }, "NOT_ELIGIBLE", "ERROR", def.key, v, x.who);
        else if (rule.cap !== null && n > rule.cap) add({ id: x.rowId, rowNo: x.rowNo }, "OVER_CAP", "FLAG", def.key, `${v} > ${rule.cap}`, x.who);
      }
    }
  }

  if (target === "gpf") {
    const opened = new Set((await db.gpfEntry.findMany({ where: { boardId, kind: "OPENING", employeeId: { in: staff.map((s) => s.id) } }, select: { employeeId: true } })).map((g) => g.employeeId));
    for (const x of records) {
      const e = needStaff(x);
      if (e && opened.has(e.id)) loadedRows.add(x.rowId);
      else if (num(x.values.balance) < 0) add({ id: x.rowId, rowNo: x.rowNo }, "NEGATIVE", "ERROR", "balance", x.values.balance ?? "", x.who);
      else if (e && e.type !== "PERMANENT_OPS") add({ id: x.rowId, rowNo: x.rowNo }, "NOT_OPS", "FLAG", "employeeCode", e.type, x.who);
    }
  }

  if (target === "loans") {
    const brought = await db.loan.findMany({ where: { boardId, employeeId: { in: staff.map((s) => s.id) }, purpose: { startsWith: "Brought from the old system" } }, select: { employeeId: true, type: true } });
    const had = new Set(brought.map((l) => `${l.employeeId}|${l.type}`));
    for (const x of records) {
      const e = needStaff(x, true);
      if (e && had.has(`${e.id}|${x.values.loanType}`)) {
        loadedRows.add(x.rowId);
        continue;
      }
      if (num(x.values.principalLeft) + num(x.values.interestLeft) <= 0) add({ id: x.rowId, rowNo: x.rowNo }, "NOTHING_LEFT", "ERROR", "principalLeft", x.values.principalLeft ?? "0", x.who);
      if (num(x.values.instalment) <= 0) add({ id: x.rowId, rowNo: x.rowNo }, "BAD_NUMBER", "ERROR", "instalment", x.values.instalment ?? "", x.who);
    }
  }

  if (target === "tax") {
    const fy = options.fy ?? currentFy();
    const carried = new Set((await db.taxCarryIn.findMany({ where: { boardId, fy, employeeId: { in: staff.map((s) => s.id) } }, select: { employeeId: true } })).map((c) => c.employeeId));
    for (const x of records) {
      const e = needStaff(x);
      if (e && carried.has(e.id)) loadedRows.add(x.rowId);
      else if (num(x.values.tds) > num(x.values.salary)) add({ id: x.rowId, rowNo: x.rowNo }, "TDS_OVER_SALARY", "ERROR", "tds", `${x.values.tds} > ${x.values.salary}`, x.who);
    }
  }

  if (target === "pensioners") {
    const ppos = records.map((x) => x.values.ppoNumber?.toUpperCase()).filter((x): x is string => Boolean(x));
    const existing = new Set((await db.pensioner.findMany({ where: { boardId, ppoNumber: { in: ppos } }, select: { ppoNumber: true } })).map((p) => p.ppoNumber));
    const retirees = records.map((x) => x.values.retireeCode?.toUpperCase()).filter((x): x is string => Boolean(x));
    const serving = new Set((await db.employee.findMany({ where: { boardId, employeeCode: { in: retirees }, status: { in: ["ACTIVE", "SUSPENDED", "DRAFT"] } }, select: { employeeCode: true } })).map((e) => e.employeeCode!.toUpperCase()));
    const seen = new Map<string, number>();
    const banks = new Map<string, number>();
    for (const x of records) {
      const v = x.values;
      const at = { id: x.rowId, rowNo: x.rowNo };
      const ppo = v.ppoNumber?.toUpperCase() ?? "";
      if (existing.has(ppo)) {
        loadedRows.add(x.rowId);
        continue;
      }
      if (seen.has(ppo)) add(at, "DUPLICATE_IN_FILE", "ERROR", "ppoNumber", `#${seen.get(ppo)}`, x.who);
      seen.set(ppo, x.rowNo);
      const relation = v.relation ?? (v.pensionType === "FAMILY" ? null : "SELF");
      if (!relation) add(at, "MISSING", "ERROR", "relation", undefined, x.who);
      if (v.pensionType && relation && (v.pensionType === "FAMILY") !== (relation !== "SELF")) add(at, "RELATION_TYPE", "ERROR", "relation", `${v.pensionType} / ${relation}`, x.who);
      if (v.pensionType === "FAMILY" && !v.deathDate) add(at, "MISSING", "ERROR", "deathDate", undefined, x.who);
      if (relation && relation !== "SELF" && !v.retireeName) add(at, "MISSING", "ERROR", "retireeName", undefined, x.who);
      if (relation && relation !== "SELF" && !v.retireeDob) add(at, "MISSING", "ERROR", "retireeDob", undefined, x.who);
      if (v.retireeCode && serving.has(v.retireeCode.toUpperCase())) add(at, "STILL_SERVING", "ERROR", "retireeCode", v.retireeCode, x.who);
      if (v.bankAccount && !isValidBankAccount(v.bankAccount)) add(at, "BAD_BANK", "ERROR", "bankAccount", undefined, x.who);
      if (v.ifsc && !isValidIfsc(v.ifsc)) add(at, "BAD_IFSC", "ERROR", "ifsc", v.ifsc, x.who);
      if (v.mobile && !MOBILE_RE.test(v.mobile.replace(/\D/g, "").slice(-10))) add(at, "BAD_MOBILE", "FLAG", "mobile", v.mobile, x.who);
      if (num(v.commutedAmount) > 0 && !v.commutationDate) add(at, "MISSING", "ERROR", "commutationDate", undefined, x.who);
      if (v.startDate && v.startDate > todayIST()) add(at, "FUTURE_DATE", "ERROR", "startDate", v.startDate, x.who);
      if (num(v.basicPension) <= 0 && v.basicPension !== null) add(at, "BAD_NUMBER", "ERROR", "basicPension", v.basicPension, x.who);
      if (v.bankAccount) {
        const h = blindIndex("bank", v.bankAccount.replace(/\s/g, ""));
        if (banks.has(h)) add(at, "SAME_BANK", "FLAG", "bankAccount", `#${banks.get(h)}`, x.who);
        banks.set(h, x.rowNo);
      }
    }
  }

  // Explanations written for issues (§15 "Exceptions": fixed or explained in writing).
  const notes = await db.migrationNote.findMany({ where: { boardId, key: { in: issues.map((i) => i.key) } } });
  const noteBy = new Map(notes.map((n) => [n.key, n]));
  for (const i of issues) {
    const n = noteBy.get(i.key);
    i.note = n ? { text: n.note, byName: n.byName, at: n.createdAt.toISOString() } : null;
  }
  const live = issues.filter((i) => !loadedRows.has(i.rowId));
  const open = live.filter((i) => !i.note).length;
  const blocked = new Set(live.filter((i) => i.level === "ERROR").map((i) => i.rowId));
  const kept = records.filter((x) => !loadedRows.has(x.rowId));
  return {
    ...empty,
    file: { id: file.id, tableName: file.tableName, fileName: file.fileName, liveCount: file.liveCount },
    records: kept,
    all: records,
    issues: live,
    leftOut,
    loaded: loadedRows.size,
    ready: kept.filter((x) => !blocked.has(x.rowId)),
    open,
  };
}

/** The as-on month of opening balances (the day before cut-over): "2026-09" from "2026-09-30". */
export const asOnMonth = (asOn: string) => toISODate(fromISODate(asOn)).slice(0, 7);
