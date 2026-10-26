import "server-only";
import { z } from "zod";
import type { ApprovalTask, Prisma } from "@/generated/prisma/client";
import { submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import { can, canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { randomToken } from "@/lib/crypto";
import { db, type DbLike, type Tx } from "@/lib/db";
import { todayIST, toISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { formatINR } from "@/lib/money";
import { emit } from "@/lib/outbox";
import { loadFile, mimeOf, saveFile, sniff } from "@/lib/storage";
import { fullName } from "@/modules/employees/present";
import type { PayLine } from "@/modules/payroll/engine";
import { statutorySettings } from "./settings";
import { DEDUCTION_CAPS, EMPTY_ITEMS, fyMonths, fyOfMonth, taxWorking, type DeclaredItems, type Regime } from "./tax-rules";
import { addParts, headFlags, monthsStillToCome, partsOf, taxRulesFor, ZERO_PARTS, type SalaryParts, type TaxDetail } from "./tds-projection";

/**
 * ST-02, ST-03, S-51: each employee chooses the tax regime for the year (new regime unless they say otherwise) and
 * declares old-regime deductions at the start of the year, with proofs before January. HR & Accounts (a Checker)
 * verify; the payroll's projection uses declared figures until December and verified ones from January (ST-04).
 */
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const MAX_PROOFS = 20;

const amount = z.coerce.number().min(0, "validation.invalid").max(10_000_000, "validation.invalid");
export const itemsSchema = z.object({ sec80C: amount, sec80D: amount, sec80CCD1B: amount, homeLoanInterest: amount, rentPaid: amount, otherIncome: amount });
export const declarationSchema = z.object({ regime: z.enum(["NEW", "OLD"]), items: itemsSchema, submit: z.boolean().default(false) });
export const carryInSchema = z.object({
  employeeId: z.string().min(1),
  fy: z.string().regex(/^\d{4}-\d{2}$/),
  salary: amount,
  tds: amount,
  note: z.string().trim().min(5, "validation.tooShort").max(200),
});

export interface Proof {
  id: string;
  key: string;
  name: string;
  size: number;
  sha256: string;
  mimeType: string;
  at: string;
}

const canSeeAll = (actor: Actor) => canAll(actor, "statutory", "view");
const canManage = (actor: Actor) => canAll(actor, "statutory", "create");
export const currentFy = (today = todayIST()) => fyOfMonth(today.slice(0, 7));

/** A proof as the screens see it — without its storage key. */
const shownProof = (p: Proof) => ({ id: p.id, name: p.name, size: p.size, sha256: p.sha256, mimeType: p.mimeType, at: p.at });
const itemsOf = (raw: unknown): DeclaredItems => ({ ...EMPTY_ITEMS, ...((raw ?? {}) as Partial<DeclaredItems>) });
const proofsOf = (raw: unknown): Proof[] => (Array.isArray(raw) ? (raw as Proof[]) : []);

/**
 * The person's year in figures for the regime comparison: salary of the year paid so far (with any carried in), and the
 * latest month's pay for each month still to come — the same projection the payroll makes.
 */
export async function yearOutlook(tx: DbLike, boardId: string, employeeId: string, fy: string) {
  const [from, to] = fyMonths(fy);
  const [heads, e, carried, slips, latest] = await Promise.all([
    tx.payHead.findMany({ where: { boardId } }),
    tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { type: true, dateOfRetirement: true, contractEnd: true, exitDate: true } }),
    tx.taxCarryIn.findUnique({ where: { employeeId_fy: { employeeId, fy } } }),
    tx.payslip.findMany({ where: { employeeId, month: { gte: from, lte: to }, status: "INCLUDED", run: { status: { in: [...PAID] } } }, select: { month: true, lines: true, detail: true, run: { select: { kind: true } } }, orderBy: { month: "asc" } }),
    tx.payslip.findFirst({ where: { employeeId, run: { kind: "REGULAR", status: { in: [...PAID] } } }, select: { month: true, lines: true }, orderBy: { month: "desc" } }),
  ]);
  const flags = headFlags(heads);
  let paid: SalaryParts = carried ? { ...ZERO_PARTS, gross: num(carried.salary), tds: num(carried.tds) } : { ...ZERO_PARTS };
  for (const s of slips) paid = addParts(paid, partsOf(s.lines as unknown as PayLine[], flags));
  const monthly = latest ? partsOf(latest.lines as unknown as PayLine[], flags) : { ...ZERO_PARTS };
  const lastDay = e.exitDate ?? (["CONTRACT", "DAILY_WAGE", "REEMPLOYED"].includes(e.type) ? e.contractEnd : e.dateOfRetirement);
  const lastPaid = slips.filter((s) => s.run.kind === "REGULAR").at(-1)?.month;
  // Months to come: after the last month paid this year, or — before the first pay of the year — the whole year left.
  const startFrom = lastPaid ?? (todayIST().slice(0, 7) > from ? todayIST().slice(0, 7) : from);
  const toCome = monthsStillToCome(startFrom, fy, lastDay ? toISODate(lastDay) : null) + (lastPaid ? 0 : 1);
  const year = addParts(paid, monthly, toCome);
  const tax = (slips.filter((s) => s.run.kind === "REGULAR").at(-1)?.detail as { tax?: TaxDetail } | null)?.tax ?? null;
  return { paid, monthly, toCome, year, tdsSoFar: paid.tds, lastTax: tax, carriedIn: carried ? { salary: num(carried.salary), tds: num(carried.tds), note: carried.note } : null };
}

async function pendingTask(tx: DbLike, boardId: string, declarationId: string) {
  return tx.approvalTask.findFirst({ where: { boardId, entityType: "TaxDeclaration", entityId: declarationId, status: "PENDING" } });
}

function present(d: { id: string; fy: string; regime: string; items: unknown; proofs: unknown; status: string; remarks: string | null; submittedAt: Date | null; verifiedAt: Date | null }) {
  return { id: d.id, fy: d.fy, regime: d.regime as Regime, items: itemsOf(d.items), proofs: proofsOf(d.proofs).map(shownProof), status: d.status, remarks: d.remarks, submittedAt: d.submittedAt?.toISOString() ?? null, verifiedAt: d.verifiedAt?.toISOString() ?? null };
}

/** S-51 for the employee: this year's declaration, the figures for the regime comparison and the year's rules. */
export async function myTax(actor: Actor) {
  if (!actor.employeeId || !can(actor, "statutory", "view")) throw forbidden();
  const fy = currentFy();
  const [decl, outlook, rules, settings, proofsDue] = await Promise.all([
    db.taxDeclaration.findUnique({ where: { employeeId_fy: { employeeId: actor.employeeId, fy } } }),
    yearOutlook(db, actor.boardId, actor.employeeId, fy),
    taxRulesFor(db, actor.boardId, fy),
    statutorySettings(db, actor.boardId),
    db.dueRule.findUnique({ where: { boardId_code: { boardId: actor.boardId, code: "TAX_PROOFS" } } }),
  ]);
  const task = decl ? await pendingTask(db, actor.boardId, decl.id) : null;
  const md = proofsDue?.dates[0] ?? "12-31";
  return {
    fy,
    declaration: decl ? present(decl) : null,
    waitingForCheck: Boolean(task),
    year: outlook.year,
    tdsSoFar: outlook.tdsSoFar,
    monthsToCome: outlook.toCome,
    carriedIn: outlook.carriedIn,
    lastTax: outlook.lastTax,
    rules,
    metro: settings.metroHra,
    caps: DEDUCTION_CAPS,
    proofsDueOn: `${Number(md.slice(0, 2)) >= 4 ? fy.slice(0, 4) : Number(fy.slice(0, 4)) + 1}-${md}`,
  };
}

/** Saves the employee's choice (a draft), or sends it to HR & Accounts to verify. A change withdraws a waiting check. */
export async function saveMyDeclaration(actor: Actor, raw: unknown) {
  if (!actor.employeeId || !can(actor, "statutory", "create")) throw forbidden();
  const input = declarationSchema.parse(raw);
  const fy = currentFy();
  const e = await db.employee.findFirstOrThrow({ where: { id: actor.employeeId, boardId: actor.boardId } });
  return db.$transaction(async (tx) => {
    const existing = await tx.taxDeclaration.findUnique({ where: { employeeId_fy: { employeeId: e.id, fy } } });
    const items = input.regime === "OLD" ? input.items : { ...EMPTY_ITEMS, otherIncome: input.items.otherIncome };
    const decl = await tx.taxDeclaration.upsert({
      where: { employeeId_fy: { employeeId: e.id, fy } },
      create: { boardId: actor.boardId, employeeId: e.id, fy, regime: input.regime, items, status: input.submit ? "SUBMITTED" : "DRAFT", submittedAt: input.submit ? new Date() : null },
      update: { regime: input.regime, items, status: input.submit ? "SUBMITTED" : "DRAFT", submittedAt: input.submit ? new Date() : existing?.submittedAt, remarks: null, verifiedById: null, verifiedAt: null },
    });
    const waiting = await pendingTask(tx, actor.boardId, decl.id);
    if (waiting) await tx.approvalTask.update({ where: { id: waiting.id }, data: { status: "CANCELLED", decidedAt: new Date(), decisionNote: "Changed by the employee" } });
    if (input.submit) {
      const name = fullName(e);
      const regimeText = input.regime === "OLD" ? "old regime" : "new regime";
      await submitForApproval(tx, actor, {
        kind: "tax.declaration",
        title: `Tax declaration ${fy}: ${name} (${e.employeeCode}) — ${regimeText}`,
        titleHi: `कर घोषणा ${fy}: ${e.nameHi ?? name} (${e.employeeCode}) — ${input.regime === "OLD" ? "पुरानी व्यवस्था" : "नई व्यवस्था"}`,
        details: {
          summary: "Check the amounts against the proofs. Verified amounts count for TDS from January.",
          summaryHi: "राशियाँ प्रमाणों से मिलाएँ। सत्यापित राशियाँ जनवरी से टीडीएस में गिनी जाती हैं।",
          link: `/statutory/declarations/${e.id}`,
          rows: [
            { label: "Regime", labelHi: "व्यवस्था", old: existing && existing.regime !== input.regime ? (existing.regime === "OLD" ? "Old regime" : "New regime") : undefined, new: input.regime === "OLD" ? "Old regime" : "New regime" },
            ...(input.regime === "OLD"
              ? [
                  { label: "80C", new: formatINR(items.sec80C) },
                  { label: "80D", new: formatINR(items.sec80D) },
                  { label: "80CCD(1B)", new: formatINR(items.sec80CCD1B) },
                  { label: "Home loan interest", labelHi: "गृह ऋण ब्याज", new: formatINR(items.homeLoanInterest) },
                  { label: "Rent paid in the year", labelHi: "वर्ष में दिया किराया", new: formatINR(items.rentPaid) },
                ]
              : []),
            ...(items.otherIncome ? [{ label: "Other income", labelHi: "अन्य आय", new: formatINR(items.otherIncome) }] : []),
            { label: "Proofs attached", labelHi: "संलग्न प्रमाण", new: String(proofsOf(decl.proofs).length) },
          ],
        } satisfies ApprovalDetails,
        payload: { declarationId: decl.id },
        entityType: "TaxDeclaration",
        entityId: decl.id,
        subjectEmployeeId: e.id,
      });
    } else {
      await audit(tx, actor, { action: "UPDATE", entityType: "TaxDeclaration", entityId: decl.id, summary: `Tax declaration ${fy} saved as a draft (${input.regime === "OLD" ? "old" : "new"} regime)` });
    }
    return present(decl);
  });
}

/** ST-03: a proof (PDF or photo, up to 5 MB) attached to this year's declaration. */
export async function addProof(actor: Actor, file: File) {
  if (!actor.employeeId || !can(actor, "statutory", "create")) throw forbidden();
  if (file.size > MAX_PROOF_BYTES) throw badRequest("employees.errors.fileTooBig", { file: "employees.errors.fileTooBig" });
  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buffer);
  if (!kind || !["pdf", "png", "jpg"].includes(kind)) throw badRequest("employees.errors.fileType", { file: "employees.errors.fileType" });
  const fy = currentFy();
  const stored = await saveFile("tax-proofs", buffer, kind);
  return db.$transaction(async (tx) => {
    const decl =
      (await tx.taxDeclaration.findUnique({ where: { employeeId_fy: { employeeId: actor.employeeId!, fy } } })) ??
      (await tx.taxDeclaration.create({ data: { boardId: actor.boardId, employeeId: actor.employeeId!, fy, regime: "NEW", items: { ...EMPTY_ITEMS } as unknown as Prisma.InputJsonValue } }));
    const proofs = proofsOf(decl.proofs);
    if (proofs.length >= MAX_PROOFS) throw badRequest("statutory.tax.tooManyProofs");
    const proof: Proof = { id: randomToken(6), key: stored.key, name: file.name.slice(0, 120), size: stored.size, sha256: stored.sha256, mimeType: mimeOf(kind), at: new Date().toISOString() };
    await tx.taxDeclaration.update({ where: { id: decl.id }, data: { proofs: [...proofs, proof] as unknown as Prisma.InputJsonValue } });
    await audit(tx, actor, { action: "UPLOAD", entityType: "TaxDeclaration", entityId: decl.id, summary: `Proof "${proof.name}" added to the tax declaration ${fy}`, newValue: { sha256: proof.sha256, size: proof.size } });
    return shownProof(proof);
  });
}

export async function removeProof(actor: Actor, proofId: string) {
  if (!actor.employeeId) throw forbidden();
  const fy = currentFy();
  return db.$transaction(async (tx) => {
    const decl = await tx.taxDeclaration.findUnique({ where: { employeeId_fy: { employeeId: actor.employeeId!, fy } } });
    const proof = decl ? proofsOf(decl.proofs).find((p) => p.id === proofId) : undefined;
    if (!decl || !proof) throw notFound();
    if (decl.status === "VERIFIED" || (await pendingTask(tx, actor.boardId, decl.id))) throw conflict("statutory.tax.lockedWhileChecked");
    await tx.taxDeclaration.update({ where: { id: decl.id }, data: { proofs: proofsOf(decl.proofs).filter((p) => p.id !== proofId) as unknown as Prisma.InputJsonValue } });
    await audit(tx, actor, { action: "DELETE", entityType: "TaxDeclaration", entityId: decl.id, summary: `Proof "${proof.name}" removed from the tax declaration ${fy}` });
  });
}

/** A proof file, for its owner and for HR & Accounts. */
export async function readProof(actor: Actor, declarationId: string, proofId: string) {
  const decl = await db.taxDeclaration.findFirst({ where: { id: declarationId, boardId: actor.boardId }, include: { employee: true } });
  if (!decl) throw notFound();
  if (decl.employeeId !== actor.employeeId && !canSeeAll(actor)) throw forbidden();
  const proof = proofsOf(decl.proofs).find((p) => p.id === proofId);
  if (!proof) throw notFound();
  const buffer = await loadFile(proof.key);
  if (decl.employeeId !== actor.employeeId) await audit(db, actor, { action: "DOWNLOAD", entityType: "TaxDeclaration", entityId: decl.id, summary: `Opened tax proof "${proof.name}" of ${fullName(decl.employee)}`, sensitive: true });
  return { buffer, proof };
}

// ─── HR & Accounts ────────────────────────────────────────────────────────────

/** S-51 for HR & Accounts: everyone on the rolls with their regime, declaration status and the year's tax so far. */
export async function listDeclarations(actor: Actor, opts: { fy?: string; status?: string } = {}) {
  if (!canSeeAll(actor)) throw forbidden();
  const fy = opts.fy ?? currentFy();
  const [from, to] = fyMonths(fy);
  const employees = await db.employee.findMany({
    where: { boardId: actor.boardId, employeeCode: { not: null }, status: { in: ["ACTIVE", "SUSPENDED"] } },
    select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, panLast4: true, type: true, taxDeclarations: { where: { fy } } },
    orderBy: { employeeCode: "asc" },
  });
  const slips = await db.payslip.findMany({
    where: { boardId: actor.boardId, month: { gte: from, lte: to }, status: "INCLUDED", run: { kind: "REGULAR", status: { in: [...PAID] } } },
    select: { employeeId: true, month: true, detail: true },
    orderBy: { month: "asc" },
  });
  const latestTax = new Map<string, TaxDetail>();
  for (const s of slips) {
    const t = (s.detail as { tax?: TaxDetail } | null)?.tax;
    if (t) latestTax.set(s.employeeId, t);
  }
  const tasks = await db.approvalTask.findMany({ where: { boardId: actor.boardId, kind: "tax.declaration", status: "PENDING" }, select: { id: true, entityId: true } });
  const taskBy = new Map(tasks.map((t) => [t.entityId, t.id]));
  const rows = employees.map((e) => {
    const d = e.taxDeclarations.at(0);
    const items = itemsOf(d?.items);
    const t = latestTax.get(e.id);
    return {
      employeeId: e.id,
      code: e.employeeCode ?? "",
      name: fullName(e),
      nameHi: e.nameHi,
      hasPan: Boolean(e.panLast4),
      declarationId: d?.id ?? null,
      regime: (d && d.status !== "DRAFT" ? d.regime : "NEW") as Regime,
      status: d?.status ?? "NONE",
      declared: d?.regime === "OLD" ? items.sec80C + items.sec80D + items.sec80CCD1B + items.homeLoanInterest : 0,
      proofs: proofsOf(d?.proofs).length,
      taskId: d ? (taskBy.get(d.id) ?? null) : null,
      annualTax: t?.annualTax ?? 0,
      deducted: t ? t.deductedSoFar + (t.monthly ?? 0) : 0,
    };
  });
  const filtered = opts.status && opts.status !== "ALL" ? rows.filter((r) => (opts.status === "WAITING" ? r.taskId : r.status === opts.status)) : rows;
  return {
    fy,
    rows: filtered,
    counts: {
      all: rows.length,
      waiting: rows.filter((r) => r.taskId).length,
      verified: rows.filter((r) => r.status === "VERIFIED").length,
      old: rows.filter((r) => r.regime === "OLD").length,
      none: rows.filter((r) => r.status === "NONE" || r.status === "DRAFT").length,
    },
    canManage: canManage(actor),
  };
}

/** One person's year for HR & Accounts: the declaration and proofs (if any), carried-in salary, and the tax both ways. */
export async function getDeclaration(actor: Actor, employeeId: string, fyParam?: string) {
  if (!canSeeAll(actor)) throw forbidden();
  const fy = fyParam && /^\d{4}-\d{2}$/.test(fyParam) ? fyParam : currentFy();
  const e = await db.employee.findFirst({ where: { id: employeeId, boardId: actor.boardId }, select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, panLast4: true, type: true } });
  if (!e) throw notFound();
  const d = await db.taxDeclaration.findUnique({ where: { employeeId_fy: { employeeId, fy } } });
  const [outlook, rules, settings, task, carryTask] = await Promise.all([
    yearOutlook(db, actor.boardId, employeeId, fy),
    taxRulesFor(db, actor.boardId, fy),
    statutorySettings(db, actor.boardId),
    d ? pendingTask(db, actor.boardId, d.id) : null,
    db.approvalTask.findFirst({ where: { boardId: actor.boardId, kind: "tax.carryin", entityId: employeeId, status: "PENDING" }, select: { id: true } }),
  ]);
  const items = d ? itemsOf(d.items) : EMPTY_ITEMS;
  const chosen = d && d.status !== "DRAFT" ? (d.regime as Regime) : "NEW";
  return {
    fy,
    declaration: d ? present(d) : null,
    employee: { id: e.id, code: e.employeeCode ?? "", name: fullName(e), nameHi: e.nameHi, panLast4: e.panLast4 },
    year: outlook.year,
    tdsSoFar: outlook.tdsSoFar,
    carriedIn: outlook.carriedIn,
    lastTax: outlook.lastTax,
    chosen,
    workings: { NEW: taxWorking(outlook.year, "NEW", { ...EMPTY_ITEMS, otherIncome: items.otherIncome }, rules.NEW, settings.metroHra), OLD: taxWorking(outlook.year, "OLD", items, rules.OLD, settings.metroHra) },
    taskId: task?.id ?? null,
    carryInTaskId: carryTask?.id ?? null,
    canManage: canManage(actor),
  };
}

/**
 * ST-04: salary and TDS of the year paid outside this system — the old system before cut-over, or a previous employer
 * (Form 12B). It changes the TDS, so Payroll enters it and a Checker checks it.
 */
export async function proposeCarryIn(actor: Actor, raw: unknown) {
  if (!canManage(actor)) throw forbidden();
  const input = carryInSchema.parse(raw);
  const e = await db.employee.findFirst({ where: { id: input.employeeId, boardId: actor.boardId } });
  if (!e) throw notFound();
  const old = await db.taxCarryIn.findUnique({ where: { employeeId_fy: { employeeId: e.id, fy: input.fy } } });
  return db.$transaction(async (tx) => {
    if (await tx.approvalTask.findFirst({ where: { boardId: actor.boardId, kind: "tax.carryin", entityId: e.id, status: "PENDING" } })) throw conflict("statutory.tax.carryInWaiting");
    return submitForApproval(tx, actor, {
      kind: "tax.carryin",
      title: `Salary paid outside the system ${input.fy}: ${fullName(e)} (${e.employeeCode})`,
      titleHi: `सिस्टम के बाहर दिया वेतन ${input.fy}: ${e.nameHi ?? fullName(e)} (${e.employeeCode})`,
      details: {
        summary: "Counted in the year's TDS projection and in Form 16. Check it against the old system or Form 12B.",
        summaryHi: "वर्ष के टीडीएस अनुमान और फ़ॉर्म 16 में गिना जाता है। पुराने सिस्टम या फ़ॉर्म 12बी से मिलाएँ।",
        link: `/statutory/declarations/${e.id}?fy=${input.fy}`,
        rows: [
          { label: "Salary", labelHi: "वेतन", old: old ? formatINR(num(old.salary)) : undefined, new: formatINR(input.salary) },
          { label: "TDS", labelHi: "टीडीएस", old: old ? formatINR(num(old.tds)) : undefined, new: formatINR(input.tds) },
          { label: "Note", labelHi: "टिप्पणी", new: input.note },
        ],
      } satisfies ApprovalDetails,
      payload: input,
      entityType: "Employee",
      entityId: e.id,
      subjectEmployeeId: e.id,
    });
  });
}

// ─── Decisions ────────────────────────────────────────────────────────────────

export async function onDeclarationVerified(tx: Tx, task: ApprovalTask, actor: Actor, declarationId: string) {
  const d = await tx.taxDeclaration.update({ where: { id: declarationId }, data: { status: "VERIFIED", verifiedById: actor.userId, verifiedAt: new Date(), remarks: null } });
  await emit(tx, task.boardId, "tax.declaration.verified", { type: "TaxDeclaration", id: d.id }, { employeeId: d.employeeId, fy: d.fy, regime: d.regime });
}

export async function onDeclarationReturned(tx: Tx, declarationId: string, note: string | null) {
  await tx.taxDeclaration.update({ where: { id: declarationId }, data: { status: "RETURNED", remarks: note } });
}

export async function onDeclarationWithdrawn(tx: Tx, declarationId: string) {
  await tx.taxDeclaration.update({ where: { id: declarationId }, data: { status: "DRAFT" } });
}

export async function applyCarryIn(tx: Tx, task: ApprovalTask, p: z.infer<typeof carryInSchema>) {
  const row = await tx.taxCarryIn.upsert({
    where: { employeeId_fy: { employeeId: p.employeeId, fy: p.fy } },
    create: { boardId: task.boardId, employeeId: p.employeeId, fy: p.fy, salary: p.salary, tds: p.tds, note: p.note, createdById: task.makerId },
    update: { salary: p.salary, tds: p.tds, note: p.note },
  });
  await emit(tx, task.boardId, "tax.carryin.changed", { type: "TaxCarryIn", id: row.id }, { employeeId: p.employeeId, fy: p.fy });
}

