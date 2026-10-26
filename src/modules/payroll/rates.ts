import "server-only";
import ExcelJS from "exceljs";
import { z } from "zod";
import { pendingFor, submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import { can, canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db, type Tx } from "@/lib/db";
import { formatDate, fromISODate, isMonth, toISODate, type ISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { emit } from "@/lib/outbox";
import { isoDateField } from "@/lib/validators";
import { fullName } from "@/modules/employees/present";
import { levelOrder, matrixOn, payHeads, ratesOn } from "./compute";
import { RATE_CATALOG, RATE_KEYS } from "./rate-catalog";

const canSeeRules = (actor: Actor) => can(actor, "rates_rules", "view") || can(actor, "payroll", "view");
const canPropose = (actor: Actor) => canAll(actor, "rates_rules", "create");

/** S-81: everything on the Rates and rules screen. */
export async function rulesOverview(actor: Actor) {
  if (!canSeeRules(actor)) throw forbidden();
  const [rates, matrices, heads, pending] = await Promise.all([
    db.payRate.findMany({ where: { boardId: actor.boardId }, orderBy: [{ key: "asc" }, { effectiveFrom: "desc" }] }),
    db.payMatrix.findMany({ where: { boardId: actor.boardId }, orderBy: { effectiveFrom: "desc" } }),
    payHeads(actor.boardId, db),
    db.approvalTask.findMany({ where: { boardId: actor.boardId, status: "PENDING", kind: { in: ["rate.change", "payhead.change", "matrix.add"] } }, select: { kind: true, entityId: true, title: true, titleHi: true, makerName: true, createdAt: true } }),
  ]);
  const byKey = RATE_CATALOG.map((def) => {
    const history = rates.filter((r) => r.key === def.key).map((r) => ({ value: Number(r.value), effectiveFrom: toISODate(r.effectiveFrom), note: r.note }));
    return { ...def, history };
  });
  return {
    rates: byKey,
    matrices: matrices.map((m) => ({ id: m.id, name: m.name, effectiveFrom: toISODate(m.effectiveFrom), levels: m.levels as Record<string, number[]> })),
    heads,
    pending,
    canPropose: canPropose(actor),
  };
}

// ─── Proposing (HR / Payroll / Pension propose, an Admin approves) ────────────

export const rateProposalSchema = z.object({
  key: z.string().refine((k) => RATE_KEYS.includes(k), "validation.invalid"),
  value: z.coerce.number().min(0).max(10_000_000),
  effectiveFrom: isoDateField,
  note: z.string().trim().min(3, "validation.tooShort").max(300),
});

/** PR-02: a new value for a rate from a date — e.g. a DA order. A past date leads to arrears (PR-08). */
export async function proposeRate(actor: Actor, raw: unknown) {
  if (!canPropose(actor)) throw forbidden();
  const input = rateProposalSchema.parse(raw);
  const def = RATE_CATALOG.find((d) => d.key === input.key)!;
  const current = await ratesOn(actor.boardId, input.effectiveFrom, db);
  return db.$transaction(async (tx) => {
    if ((await pendingFor(actor.boardId, "PayRate", input.key, ["rate.change"], tx)).length) throw conflict("payroll.errors.ratePending");
    const unit = def.unit === "PERCENT" ? "%" : " ₹";
    const task = await submitForApproval(tx, actor, {
      kind: "rate.change",
      title: `${def.name}: ${input.value}${unit.trim() === "%" ? "%" : ""} from ${formatDate(input.effectiveFrom)}`,
      titleHi: `${def.nameHi}: ${input.value}${unit.trim() === "%" ? "%" : ""} — ${formatDate(input.effectiveFrom, "hi")} से`,
      details: {
        rows: [
          { label: def.name, labelHi: def.nameHi, old: current[input.key] !== undefined ? String(current[input.key]) : null, new: String(input.value) },
          { label: "From", labelHi: "से", new: formatDate(input.effectiveFrom) },
          { label: "Order / reason", labelHi: "आदेश / कारण", new: input.note },
        ],
        link: "/admin/rates",
      } satisfies ApprovalDetails,
      payload: input,
      entityType: "PayRate",
      entityId: input.key,
      note: input.note,
    });
    await audit(tx, actor, { action: "SUBMIT", entityType: "PayRate", entityId: input.key, summary: `Proposed ${def.name} = ${input.value} from ${formatDate(input.effectiveFrom)}`, newValue: input });
    return task;
  });
}

export async function applyRate(tx: Tx, boardId: string, actor: Actor, p: z.infer<typeof rateProposalSchema>) {
  await tx.payRate.upsert({
    where: { boardId_key_effectiveFrom: { boardId, key: p.key, effectiveFrom: fromISODate(p.effectiveFrom) } },
    create: { boardId, key: p.key, value: p.value, effectiveFrom: fromISODate(p.effectiveFrom), note: p.note, createdById: actor.userId },
    update: { value: p.value, note: p.note },
  });
  await emit(tx, boardId, "rate.changed", { type: "PayRate", id: p.key }, p);
}

export const headProposalSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z_]{2,16}$/, "validation.invalid"),
  name: z.string().trim().min(2, "validation.required").max(80),
  nameHi: z.string().trim().min(2, "validation.required").max(80),
  kind: z.enum(["EARNING", "DEDUCTION", "EMPLOYER"]),
  calc: z.enum(["SYSTEM", "FIXED", "PERCENT_BASIC", "ITEM"]),
  value: z.coerce.number().min(0).max(1_000_000),
  postCodes: z.array(z.string().trim().toUpperCase().max(10)).max(40),
  prorate: z.boolean(),
  taxable: z.boolean(),
  accountHead: z.string().trim().min(2, "validation.required").max(120),
  isActive: z.boolean(),
  note: z.string().trim().max(300).optional(),
});

/** PR-03 / PR-04: change a pay head's formula, amount, posts or account head — or add a head. */
export async function proposeHead(actor: Actor, raw: unknown) {
  if (!canPropose(actor)) throw forbidden();
  const input = headProposalSchema.parse(raw);
  const current = await db.payHead.findUnique({ where: { boardId_code: { boardId: actor.boardId, code: input.code } } });
  if (current?.calc === "SYSTEM" && input.calc !== "SYSTEM") throw badRequest("payroll.errors.systemHead");
  if (!current && input.calc === "SYSTEM") throw badRequest("payroll.errors.systemHead");
  const fields = ["name", "nameHi", "calc", "value", "postCodes", "prorate", "taxable", "accountHead", "isActive"] as const;
  const rows: NonNullable<ApprovalDetails["rows"]> = [];
  for (const f of fields) {
    const before = current ? (f === "value" ? Number(current.value) : current[f]) : null;
    const after = input[f];
    if (JSON.stringify(before) !== JSON.stringify(after)) rows.push({ label: f, old: before === null ? null : Array.isArray(before) ? before.join(", ") : String(before), new: Array.isArray(after) ? after.join(", ") || "—" : String(after) });
  }
  if (!rows.length) throw badRequest("payroll.errors.noChange");
  return db.$transaction(async (tx) => {
    if ((await pendingFor(actor.boardId, "PayHead", input.code, ["payhead.change"], tx)).length) throw conflict("payroll.errors.headPending");
    const task = await submitForApproval(tx, actor, {
      kind: "payhead.change",
      title: `${current ? "Pay head change" : "New pay head"}: ${input.code} (${input.name})`,
      titleHi: `${current ? "वेतन मद में बदलाव" : "नया वेतन मद"}: ${input.code} (${input.nameHi})`,
      details: { rows, link: "/admin/rates?tab=heads" } satisfies ApprovalDetails,
      payload: input,
      entityType: "PayHead",
      entityId: input.code,
      note: input.note,
    });
    await audit(tx, actor, { action: "SUBMIT", entityType: "PayHead", entityId: input.code, summary: `Proposed a change to pay head ${input.code}`, newValue: input });
    return task;
  });
}

export async function applyHead(tx: Tx, boardId: string, p: z.infer<typeof headProposalSchema>) {
  const data = { name: p.name, nameHi: p.nameHi, kind: p.kind, calc: p.calc, value: p.value, postCodes: p.postCodes, prorate: p.prorate, taxable: p.taxable, accountHead: p.accountHead, isActive: p.isActive };
  const existing = await tx.payHead.findUnique({ where: { boardId_code: { boardId, code: p.code } } });
  if (existing) await tx.payHead.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
  else {
    const last = await tx.payHead.aggregate({ where: { boardId }, _max: { sortOrder: true } });
    await tx.payHead.create({ data: { ...data, boardId, code: p.code, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
  }
  await emit(tx, boardId, "payhead.changed", { type: "PayHead", id: p.code }, data);
}

/** PR-01: a new pay matrix (a pay commission) from a date, read from an Excel sheet: Level, then one column per cell. */
export async function proposeMatrix(actor: Actor, buffer: Buffer, meta: { name: string; effectiveFrom: string }) {
  if (!canPropose(actor)) throw forbidden();
  const date = isoDateField.safeParse(meta.effectiveFrom);
  if (!date.success) throw badRequest("errors.validation", { effectiveFrom: "validation.date" });
  const name = meta.name.trim().slice(0, 80);
  if (name.length < 2) throw badRequest("errors.validation", { name: "validation.required" });
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw badRequest("employees.errors.notExcel", { file: "employees.errors.notExcel" });
  }
  const ws = wb.worksheets[0];
  const levels: Record<string, number[]> = {};
  ws?.eachRow((row, n) => {
    if (n === 1) return;
    const level = String(row.getCell(1).text ?? "").trim().replace(/^level\s*/i, "");
    if (!level) return;
    const cells: number[] = [];
    for (let c = 2; c <= row.cellCount; c++) {
      const v = Number(String(row.getCell(c).text ?? "").replace(/[,\s₹]/g, ""));
      if (Number.isFinite(v) && v > 0) cells.push(v);
    }
    if (cells.length) levels[level] = cells;
  });
  const bad = Object.entries(levels).filter(([, cells]) => cells.some((v, i) => i > 0 && v <= cells[i - 1]));
  if (Object.keys(levels).length === 0 || bad.length) throw badRequest("payroll.errors.matrixFile", undefined, { levels: bad.map(([l]) => l).join(", ") || "—" });
  return db.$transaction(async (tx) => {
    if ((await pendingFor(actor.boardId, "PayMatrix", date.data, ["matrix.add"], tx)).length) throw conflict("payroll.errors.matrixPending");
    const task = await submitForApproval(tx, actor, {
      kind: "matrix.add",
      title: `Pay matrix "${name}" from ${formatDate(date.data)} (${Object.keys(levels).length} levels)`,
      titleHi: `वेतन मैट्रिक्स "${name}" — ${formatDate(date.data, "hi")} से (${Object.keys(levels).length} लेवल)`,
      details: {
        rows: Object.entries(levels).map(([l, cells]) => ({ label: `Level ${l}`, labelHi: `लेवल ${l}`, new: `${cells.length} cells: ₹${cells[0].toLocaleString("en-IN")} – ₹${cells.at(-1)!.toLocaleString("en-IN")}` })),
        link: "/admin/rates?tab=matrix",
      } satisfies ApprovalDetails,
      payload: { name, effectiveFrom: date.data, levels },
      entityType: "PayMatrix",
      entityId: date.data,
    });
    await audit(tx, actor, { action: "SUBMIT", entityType: "PayMatrix", entityId: date.data, summary: `Proposed pay matrix "${name}" from ${formatDate(date.data)}` });
    return task;
  });
}

export async function applyMatrix(tx: Tx, boardId: string, actor: Actor, p: { name: string; effectiveFrom: ISODate; levels: Record<string, number[]> }) {
  await tx.payMatrix.upsert({
    where: { boardId_effectiveFrom: { boardId, effectiveFrom: fromISODate(p.effectiveFrom) } },
    create: { boardId, name: p.name, effectiveFrom: fromISODate(p.effectiveFrom), levels: p.levels, createdById: actor.userId },
    update: { name: p.name, levels: p.levels },
  });
  await emit(tx, boardId, "matrix.added", { type: "PayMatrix", id: p.effectiveFrom }, { name: p.name });
}

// ─── Standing pay items (PR-03/PR-04 per person) ──────────────────────────────

export const payItemSchema = z.object({
  employeeId: z.string().min(1),
  headCode: z.string().min(1).max(16),
  amount: z.coerce.number().min(0).max(1_000_000),
  fromMonth: z.string().refine(isMonth, "validation.invalid"),
  toMonth: z.union([z.literal("").transform(() => null), z.string().refine(isMonth, "validation.invalid")]).nullish(),
  note: z.string().trim().max(200).optional(),
  /** Ends an existing item instead of adding one. */
  endItemId: z.string().optional(),
});

export async function employeePayItems(actor: Actor, employeeId: string) {
  if (!canAll(actor, "payroll", "view")) throw forbidden();
  return db.employeePayItem.findMany({ where: { boardId: actor.boardId, employeeId }, orderBy: [{ toMonth: "asc" }, { fromMonth: "desc" }] });
}

/** The pay items screen: people to choose from, heads that can be set per person, and the chosen person's items. */
export async function payItemsScreen(actor: Actor, employeeId?: string) {
  if (!canAll(actor, "payroll", "view")) throw forbidden();
  const [people, heads] = await Promise.all([
    db.employee.findMany({ where: { boardId: actor.boardId, status: { in: ["ACTIVE", "SUSPENDED"] } }, select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true }, orderBy: { employeeCode: "asc" } }),
    db.payHead.findMany({ where: { boardId: actor.boardId, isActive: true, OR: [{ calc: "ITEM" }, { code: "GPF" }] }, orderBy: [{ sortOrder: "asc" }] }),
  ]);
  const chosen = employeeId ? people.find((p) => p.id === employeeId) : undefined;
  const [items, pending] = chosen
    ? await Promise.all([
        employeePayItems(actor, chosen.id),
        db.approvalTask.findMany({ where: { boardId: actor.boardId, kind: "payitem.change", status: "PENDING", subjectEmployeeId: chosen.id }, select: { id: true, title: true, titleHi: true, makerName: true, createdAt: true } }),
      ])
    : [[], []];
  const headBy = new Map(heads.map((h) => [h.code, h]));
  return {
    people: people.map((p) => ({ id: p.id, code: p.employeeCode ?? "", name: fullName(p), nameHi: p.nameHi })),
    heads: heads.map((h) => ({ code: h.code, name: h.name, nameHi: h.nameHi, kind: h.kind })),
    chosen: chosen ? { id: chosen.id, code: chosen.employeeCode ?? "", name: fullName(chosen), nameHi: chosen.nameHi, isSelf: chosen.id === actor.employeeId } : null,
    items: items.map((i) => ({ id: i.id, headCode: i.headCode, head: headBy.get(i.headCode) ?? null, amount: Number(i.amount), fromMonth: i.fromMonth, toMonth: i.toMonth, note: i.note })),
    pending,
    canEdit: canAll(actor, "payroll", "create"),
  };
}

/** Payroll adds or ends a standing allowance / deduction; a Checker checks it (it changes pay). */
export async function proposePayItem(actor: Actor, raw: unknown) {
  if (!canAll(actor, "payroll", "create")) throw forbidden();
  const input = payItemSchema.parse(raw);
  const e = await db.employee.findFirst({ where: { id: input.employeeId, boardId: actor.boardId } });
  if (!e) throw notFound();
  const head = await db.payHead.findUnique({ where: { boardId_code: { boardId: actor.boardId, code: input.headCode } } });
  if (!head || !head.isActive || (head.calc !== "ITEM" && head.code !== "GPF")) throw badRequest("payroll.errors.notItemHead");
  if (input.toMonth && input.toMonth < input.fromMonth) throw badRequest("errors.validation", { toMonth: "payroll.errors.toBeforeFrom" });
  const ending = input.endItemId ? await db.employeePayItem.findFirst({ where: { id: input.endItemId, employeeId: e.id } }) : null;
  if (input.endItemId && !ending) throw notFound();
  return db.$transaction(async (tx) => {
    const task = await submitForApproval(tx, actor, {
      kind: "payitem.change",
      title: `${ending ? "End" : "Add"} ${head.name}: ${fullName(e)} (${e.employeeCode})`,
      titleHi: `${ending ? "समाप्त" : "जोड़ें"} ${head.nameHi}: ${e.nameHi ?? fullName(e)} (${e.employeeCode})`,
      details: {
        rows: ending
          ? [{ label: head.name, labelHi: head.nameHi, old: `₹${Number(ending.amount).toLocaleString("en-IN")} from ${ending.fromMonth}`, new: `Ends after ${input.toMonth ?? input.fromMonth}` }]
          : [
              { label: head.name, labelHi: head.nameHi, new: `₹${input.amount.toLocaleString("en-IN")} a month` },
              { label: "From", labelHi: "से", new: input.fromMonth },
              { label: "To", labelHi: "तक", new: input.toMonth ?? "—" },
              ...(input.note ? [{ label: "Note", labelHi: "टिप्पणी", new: input.note }] : []),
            ],
        link: `/payroll/items?employee=${e.id}`,
      } satisfies ApprovalDetails,
      payload: input,
      entityType: "EmployeePayItem",
      entityId: ending?.id ?? e.id,
      subjectEmployeeId: e.id,
      note: input.note,
    });
    await audit(tx, actor, { action: "SUBMIT", entityType: "EmployeePayItem", entityId: e.id, summary: `${ending ? "Asked to end" : "Asked to add"} ${head.code} for ${fullName(e)}` });
    return task;
  });
}

export async function applyPayItem(tx: Tx, boardId: string, makerId: string, p: z.infer<typeof payItemSchema>) {
  if (p.endItemId) {
    await tx.employeePayItem.update({ where: { id: p.endItemId }, data: { toMonth: p.toMonth ?? p.fromMonth } });
  } else {
    await tx.employeePayItem.create({ data: { boardId, employeeId: p.employeeId, headCode: p.headCode, amount: p.amount, fromMonth: p.fromMonth, toMonth: p.toMonth ?? null, note: p.note ?? null, createdById: makerId } });
  }
  await emit(tx, boardId, "payitem.changed", { type: "EmployeePayItem", id: p.employeeId }, { headCode: p.headCode, amount: p.amount, fromMonth: p.fromMonth });
}

/** The matrix in force today as an Excel sheet — the template for a new commission's matrix. */
export async function matrixTemplate(actor: Actor): Promise<Buffer> {
  if (!canSeeRules(actor)) throw forbidden();
  const m = await matrixOn(actor.boardId, toISODate(new Date()), db);
  const levels = m?.levels ?? {};
  const width = Math.max(1, ...Object.values(levels).map((c) => c.length));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Pay matrix");
  ws.addRow(["Level", ...Array.from({ length: width }, (_, i) => `Cell ${i + 1}`)]);
  ws.getRow(1).font = { bold: true };
  for (const level of Object.keys(levels).sort(levelOrder)) ws.addRow([level, ...levels[level]]);
  ws.getColumn(1).width = 10;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
