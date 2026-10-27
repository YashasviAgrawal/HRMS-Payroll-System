import "server-only";
import { z } from "zod";
import type { ApprovalTask, Prisma } from "@/generated/prisma/client";
import { chainTask, submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/session";
import { seal } from "@/lib/crypto";
import { db, type DbLike, type Tx } from "@/lib/db";
import { addDays, datesOfMonth, daysBetweenInclusive, formatDate, fromISODate, todayIST, toISODate, type ISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { formatINR, fromPaise, toPaise } from "@/lib/money";
import { emit } from "@/lib/outbox";
import { isoDateField, isValidBankAccount, isValidIfsc, MOBILE_RE } from "@/lib/validators";
import { fullName } from "@/modules/employees/present";
import { workOutCase, type CaseType, type CaseWorking } from "./calculator";
import { caseFactsFor, type CaseSources } from "./case-facts";
import { canManagePension, canSeePension } from "./pensioners";
import { PENSION_TYPE_LABEL } from "./rules";

/**
 * PN-07 to PN-09, S-62: new pension cases. Retirement alerts at 12 and 6 months; a no-dues checklist per section; the
 * calculator works out pension, commutation, gratuity, leave encashment, GPF final payment and family pension from the
 * records; the Pension clerk prepares the case, a Checker checks, an Admin approves; the PPO is a PDF for physical
 * signature. On approval the pension is set up to start the day after retirement (PN-10) — the pension bill picks it up
 * — and the benefits are paid by a supplementary bill (bills.ts). Dues from the no-dues checklist and pay drawn after a
 * death are recovered from the benefits.
 */
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const OPEN = ["DRAFT", "CHECKING", "APPROVING"] as const;
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;
const RELATIONS = ["SPOUSE", "SON", "DAUGHTER", "MOTHER", "FATHER", "OTHER"] as const;

export interface CaseInputs {
  lastDay: ISODate;
  commutationPct: number;
  /** Set by hand; otherwise leave without pay and dies-non from the records. */
  nonQualifyingDays: number | null;
  /** Who gets the family pension on a death in service. */
  familyMember: { id: string; name: string; relation: string; dob: ISODate | null } | null;
  mobile: string | null;
  /** A new bank account for the pension (sealed); otherwise the employee's account at approval. */
  bank: { enc: string; hash: string; last4: string; ifsc: string; name: string | null } | null;
  fmaEligible: boolean;
  note: string | null;
}

export interface CaseDues {
  noDues: number;
  /** Pay drawn for days after a death in service. */
  salaryOverpaid: number;
  total: number;
}

export type StoredWorking = CaseWorking & { sources: CaseSources; dues: CaseDues };

const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

export const caseSchema = z
  .object({
    employeeId: z.string().min(1, "validation.required"),
    type: z.enum(["SUPERANNUATION", "VOLUNTARY", "INVALID", "COMPULSORY", "FAMILY"]),
    lastDay: isoDateField.nullable().optional(),
    commutationPct: z.coerce.number().min(0, "validation.notNegative").max(40, "pension.errors.commutationMax"),
    nonQualifyingDays: z.coerce.number().int().min(0, "validation.notNegative").max(20000).nullable().optional(),
    familyMemberId: z.string().nullable().optional(),
    mobile: z.string().trim().optional().transform((v) => v || null).refine((v) => !v || MOBILE_RE.test(v), "validation.mobile"),
    bankAccount: z.string().optional().transform((v) => (v ? v.replace(/\s/g, "") : null)).refine((v) => !v || isValidBankAccount(v), "validation.bankAccount"),
    ifsc: z.string().trim().toUpperCase().optional().transform((v) => v || null).refine((v) => !v || isValidIfsc(v), "validation.ifsc"),
    bankName: optText(100),
    fmaEligible: z.boolean().default(true),
    note: optText(500),
  })
  .superRefine((v, ctx) => {
    if (v.type !== "SUPERANNUATION" && !v.lastDay) ctx.addIssue({ code: "custom", path: ["lastDay"], message: "validation.required" });
    if (v.type === "FAMILY" && !v.familyMemberId) ctx.addIssue({ code: "custom", path: ["familyMemberId"], message: "validation.required" });
    if (v.bankAccount && !v.ifsc) ctx.addIssue({ code: "custom", path: ["ifsc"], message: "validation.required" });
    if (v.type === "FAMILY" && !v.bankAccount) ctx.addIssue({ code: "custom", path: ["bankAccount"], message: "validation.required" });
  });

/** Pay drawn in approved salary bills for the days after a death (recovered from the death gratuity). */
async function salaryAfter(tx: DbLike, employeeId: string, death: ISODate) {
  const slips = await tx.payslip.findMany({ where: { employeeId, pensionerId: null, status: "INCLUDED", month: { gte: death.slice(0, 7) }, run: { status: { in: [...PAID] } } }, select: { month: true, net: true, daysOnRoll: true } });
  let paise = 0;
  for (const s of slips) {
    const paidDays = num(s.daysOnRoll) || datesOfMonth(s.month).length;
    // In the month of death the days up to and including the death were due; every later month was not.
    const beyond = s.month === death.slice(0, 7) ? Math.max(0, paidDays - Number(death.slice(8, 10))) : paidDays;
    if (beyond > 0) paise += Math.round((toPaise(num(s.net)) * beyond) / paidDays);
  }
  return fromPaise(paise);
}

/** Works a case out afresh from the records and the inputs. Seed-safe pieces are in case-facts.ts and calculator.ts. */
export async function workCase(tx: DbLike, boardId: string, caseId: string | null, employeeId: string, type: CaseType, inputs: CaseInputs): Promise<StoredWorking> {
  const { facts, sources } = await caseFactsFor(tx, boardId, employeeId, { type, lastDay: inputs.lastDay, commutationPct: inputs.commutationPct, nonQualifyingDays: inputs.nonQualifyingDays });
  const working = workOutCase(facts);
  const noDues = caseId ? (await tx.noDuesItem.findMany({ where: { caseId, status: "DUES" }, select: { amount: true } })).reduce((s, i) => s + num(i.amount), 0) : 0;
  const salaryOverpaid = type === "FAMILY" ? await salaryAfter(tx, employeeId, inputs.lastDay) : 0;
  return { ...working, sources, dues: { noDues, salaryOverpaid, total: fromPaise(toPaise(noDues) + toPaise(salaryOverpaid)) } };
}

async function loadCase(actor: Actor, id: string, tx: DbLike = db) {
  const c = await tx.pensionCase.findFirst({ where: { id, boardId: actor.boardId }, include: { employee: { include: { post: true, section: true, family: true } }, noDues: true } });
  if (!c) throw notFound();
  return c;
}

async function inputsFrom(actor: Actor, raw: z.infer<typeof caseSchema>, e: { id: string; dateOfRetirement: Date | null; mobile: string | null }): Promise<CaseInputs> {
  const lastDay = raw.lastDay ?? (e.dateOfRetirement ? toISODate(e.dateOfRetirement) : null);
  if (!lastDay) throw badRequest("errors.validation", { lastDay: "validation.required" });
  let familyMember: CaseInputs["familyMember"] = null;
  if (raw.familyMemberId) {
    const m = await db.familyMember.findFirst({ where: { id: raw.familyMemberId, employeeId: e.id } });
    if (!m) throw badRequest("errors.validation", { familyMemberId: "validation.invalid" });
    familyMember = { id: m.id, name: m.name, relation: (RELATIONS as readonly string[]).includes(m.relation) ? m.relation : "OTHER", dob: m.dateOfBirth ? toISODate(m.dateOfBirth) : null };
    if (raw.type === "FAMILY" && !familyMember.dob) throw badRequest("errors.validation", { familyMemberId: "pension.errors.familyDob" });
  }
  const sealed = raw.bankAccount ? seal("bank", raw.bankAccount) : null;
  return {
    lastDay,
    commutationPct: raw.type === "FAMILY" ? 0 : raw.commutationPct,
    nonQualifyingDays: raw.nonQualifyingDays ?? null,
    familyMember,
    mobile: raw.mobile ?? e.mobile,
    bank: sealed ? { enc: sealed.enc, hash: sealed.hash, last4: sealed.last4, ifsc: raw.ifsc!, name: raw.bankName } : null,
    fmaEligible: raw.fmaEligible,
    note: raw.note,
  };
}

/** PN-07, PN-08: the Pension clerk starts a case — worked out at once; one no-dues item per section. */
export async function createCase(actor: Actor, raw: unknown) {
  if (!canManagePension(actor)) throw forbidden();
  const input = caseSchema.parse(raw);
  const e = await db.employee.findFirst({ where: { id: input.employeeId, boardId: actor.boardId } });
  if (!e) throw notFound();
  if (e.id === actor.employeeId) throw forbidden("errors.ownPay");
  if (!["PERMANENT_OPS", "PERMANENT_NPS"].includes(e.type)) throw badRequest("errors.validation", { employeeId: "pension.errors.notPermanent" });
  if (await db.pensionCase.findFirst({ where: { employeeId: e.id, status: { in: [...OPEN, "APPROVED"] } } })) throw conflict("pension.errors.caseExists");
  const inputs = await inputsFrom(actor, input, e);
  const working = await workCase(db, actor.boardId, null, e.id, input.type, inputs);
  const sections = await db.section.findMany({ where: { boardId: actor.boardId, isActive: true }, select: { id: true } });
  return db.$transaction(async (tx) => {
    const c = await tx.pensionCase.create({
      data: {
        boardId: actor.boardId,
        employeeId: e.id,
        type: input.type,
        retirementDate: fromISODate(inputs.lastDay),
        inputs: inputs as unknown as Prisma.InputJsonValue,
        working: working as unknown as Prisma.InputJsonValue,
        createdById: actor.userId,
        createdByName: actor.name,
        noDues: { create: sections.map((s) => ({ sectionId: s.id })) },
      },
    });
    await audit(tx, actor, { action: "CREATE", entityType: "PensionCase", entityId: c.id, summary: `Pension case started for ${fullName(e)} (${PENSION_TYPE_LABEL[input.type][0]}, last day ${formatDate(inputs.lastDay)})`, sensitive: true });
    await emit(tx, actor.boardId, "pension.case_started", { type: "PensionCase", id: c.id }, { employeeId: e.id, type: input.type });
    return { id: c.id };
  });
}

/** Changes the inputs of a case in draft and works it out again from the records as they stand now. */
export async function updateCase(actor: Actor, id: string, raw: unknown) {
  if (!canManagePension(actor)) throw forbidden();
  const c = await loadCase(actor, id);
  if (c.status !== "DRAFT") throw conflict("pension.errors.caseLocked");
  const input = caseSchema.parse({ ...(raw as object), employeeId: c.employeeId, type: (raw as { type?: string })?.type ?? c.type });
  const old = c.inputs as unknown as CaseInputs;
  const inputs = await inputsFrom(actor, input, c.employee);
  // An account not typed again stays as entered.
  if (!inputs.bank && old.bank && !input.bankAccount) inputs.bank = old.bank;
  const working = await workCase(db, actor.boardId, c.id, c.employeeId, input.type, inputs);
  return db.$transaction(async (tx) => {
    await tx.pensionCase.update({ where: { id }, data: { type: input.type, retirementDate: fromISODate(inputs.lastDay), inputs: inputs as unknown as Prisma.InputJsonValue, working: working as unknown as Prisma.InputJsonValue } });
    await audit(tx, actor, { action: "UPDATE", entityType: "PensionCase", entityId: id, summary: `Pension case of ${fullName(c.employee)} worked out again`, sensitive: true });
    return { id };
  });
}

export const noDuesSchema = z
  .object({
    status: z.enum(["CLEAR", "DUES"]),
    amount: z.coerce.number().min(0, "validation.notNegative").max(10_000_000).default(0),
    note: optText(300),
  })
  .superRefine((v, ctx) => {
    if (v.status === "DUES" && v.amount <= 0) ctx.addIssue({ code: "custom", path: ["amount"], message: "validation.required" });
    if (v.status === "DUES" && !v.note) ctx.addIssue({ code: "custom", path: ["note"], message: "validation.required" });
  });

/** PN-07: a section's answer to the no-dues checklist; dues are recovered from the benefits. */
export async function setNoDues(actor: Actor, caseId: string, sectionId: string, raw: unknown) {
  if (!canManagePension(actor)) throw forbidden();
  const input = noDuesSchema.parse(raw);
  const c = await loadCase(actor, caseId);
  if (c.status !== "DRAFT") throw conflict("pension.errors.caseLocked");
  const item = c.noDues.find((n) => n.sectionId === sectionId);
  if (!item) throw notFound();
  const section = await db.section.findUniqueOrThrow({ where: { id: sectionId } });
  return db.$transaction(async (tx) => {
    await tx.noDuesItem.update({ where: { id: item.id }, data: { status: input.status, amount: input.status === "DUES" ? input.amount : 0, note: input.note, byId: actor.userId, byName: actor.name, at: new Date() } });
    const working = c.working as unknown as StoredWorking;
    const noDues = (await tx.noDuesItem.findMany({ where: { caseId, status: "DUES" }, select: { amount: true } })).reduce((s, i) => s + num(i.amount), 0);
    const dues = { ...working.dues, noDues, total: fromPaise(toPaise(noDues) + toPaise(working.dues.salaryOverpaid)) };
    await tx.pensionCase.update({ where: { id: caseId }, data: { working: { ...working, dues } as unknown as Prisma.InputJsonValue } });
    await audit(tx, actor, { action: "UPDATE", entityType: "PensionCase", entityId: caseId, summary: `No-dues from ${section.name}: ${input.status === "CLEAR" ? "nothing due" : `${formatINR(input.amount)} due — ${input.note}`}` });
    return { ok: true };
  });
}

function caseRows(c: { type: string; employee: Parameters<typeof fullName>[0] & { employeeCode: string | null } }, inputs: CaseInputs, w: StoredWorking): NonNullable<ApprovalDetails["rows"]> {
  const rows: NonNullable<ApprovalDetails["rows"]> = [
    { label: "Employee", labelHi: "कर्मचारी", new: `${fullName(c.employee)} (${c.employee.employeeCode ?? "—"})` },
    { label: "Kind", labelHi: "प्रकार", new: PENSION_TYPE_LABEL[c.type][0] },
    { label: "Last day", labelHi: "अंतिम दिन", new: formatDate(inputs.lastDay) },
    { label: "Qualifying service", labelHi: "अर्हक सेवा", new: `${w.qs.years} years ${w.qs.months} months ${w.qs.days} days (${w.qs.halfYears} half-years)` },
    { label: "Emoluments", labelHi: "परिलब्धियाँ", new: formatINR(w.emoluments.used) },
  ];
  if (w.pension.amount) rows.push({ label: "Pension a month", labelHi: "मासिक पेंशन", new: formatINR(w.pension.amount) });
  if (w.commutation.lumpSum) rows.push({ label: "Commutation", labelHi: "रूपांतरण", new: `${w.commutation.pct}% = ${formatINR(w.commutation.monthly)} a month → ${formatINR(w.commutation.lumpSum)}` });
  if (w.gratuity.amount) rows.push({ label: "Gratuity", labelHi: "उपदान", new: formatINR(w.gratuity.amount) });
  if (w.leaveEncashment.amount) rows.push({ label: "Leave encashment", labelHi: "अवकाश नकदीकरण", new: `${w.leaveEncashment.days} days → ${formatINR(w.leaveEncashment.amount)}` });
  if (w.gpf) rows.push({ label: "GPF final payment", labelHi: "जीपीएफ अंतिम भुगतान", new: formatINR(w.gpf) });
  if (w.familyPension.enhanced) rows.push({ label: "Family pension", labelHi: "पारिवारिक पेंशन", new: `${formatINR(w.familyPension.enhanced)} to ${formatDate(w.familyPension.enhancedUntil)}, then ${formatINR(w.familyPension.normal)}` });
  if (w.dues.total) rows.push({ label: "Dues to recover", labelHi: "वसूली योग्य बकाया", new: formatINR(w.dues.total) });
  return rows;
}

/** PN-09: the case goes to a Checker, once every section has answered the no-dues checklist. */
export async function submitCase(actor: Actor, id: string, note?: string | null) {
  if (!canManagePension(actor)) throw forbidden();
  const c = await loadCase(actor, id);
  if (c.status !== "DRAFT") throw conflict("pension.errors.caseLocked");
  if (c.noDues.some((n) => n.status === "PENDING")) throw badRequest("pension.errors.noDuesPending");
  const inputs = c.inputs as unknown as CaseInputs;
  // Work it out again so the Checker sees the records as they are today.
  const working = await workCase(db, actor.boardId, c.id, c.employeeId, c.type as CaseType, inputs);
  if (!working.pension.amount && !working.gratuity.amount && !working.leaveEncashment.amount && !working.familyPension.enhanced) throw badRequest("pension.errors.nothingDue");
  return db.$transaction(async (tx) => {
    if (await tx.approvalTask.count({ where: { boardId: actor.boardId, kind: "pension.case", entityId: id, status: "PENDING" } })) throw conflict("pension.errors.caseLocked");
    await tx.pensionCase.update({ where: { id }, data: { status: "CHECKING", working: working as unknown as Prisma.InputJsonValue } });
    await submitForApproval(tx, actor, {
      kind: "pension.case",
      title: `Pension case — ${fullName(c.employee)} (${PENSION_TYPE_LABEL[c.type][0]})`,
      titleHi: `पेंशन प्रकरण — ${c.employee.nameHi ?? fullName(c.employee)} (${PENSION_TYPE_LABEL[c.type][1]})`,
      details: { rows: caseRows(c, inputs, working), link: `/pension/cases/${id}` },
      payload: { caseId: id },
      subjectEmployeeId: c.employeeId,
      entityType: "PensionCase",
      entityId: id,
      note: note ?? null,
    });
    return { id };
  });
}

/** Checker forwards → an Admin approves; approval sets the pension up and issues the PPO. */
export async function onCaseChecked(tx: Tx, task: ApprovalTask, payload: { caseId: string }) {
  await tx.pensionCase.update({ where: { id: payload.caseId }, data: { status: "APPROVING" } });
  await chainTask(tx, task, { requiredPermission: "APPROVER", payload: { ...payload, step: "approver" } });
}

export async function onCaseSentBack(tx: Tx, caseId: string, rejected: boolean) {
  await tx.pensionCase.update({ where: { id: caseId }, data: { status: rejected ? "REJECTED" : "DRAFT" } });
}

async function nextPpo(tx: Tx, boardId: string, year: string) {
  const board = await tx.board.findUniqueOrThrow({ where: { id: boardId } });
  for (;;) {
    const seq = await tx.sequence.upsert({ where: { boardId_name: { boardId, name: `ppo-${year}` } }, create: { boardId, name: `ppo-${year}`, next: 2 }, update: { next: { increment: 1 } } });
    const ppo = `${board.code}/PPO/${year}/${String(seq.next - 1).padStart(4, "0")}`;
    if (!(await tx.pensioner.findFirst({ where: { boardId, ppoNumber: ppo }, select: { id: true } }))) return ppo;
  }
}

/** PN-09, PN-10: the approved case — PPO number, the pension (or family pension) from the day after. */
export async function onCaseApproved(tx: Tx, task: ApprovalTask, actor: Actor, caseId: string) {
  const c = await tx.pensionCase.findUniqueOrThrow({ where: { id: caseId }, include: { employee: true } });
  const inputs = c.inputs as unknown as CaseInputs;
  const w = c.working as unknown as StoredWorking;
  const e = c.employee;
  const bank = inputs.bank ?? (e.bankAccountEnc && e.ifsc ? { enc: e.bankAccountEnc, hash: e.bankAccountHash!, last4: e.bankAccountLast4!, ifsc: e.ifsc, name: e.bankName } : null);
  let pensionerId: string | null = null;
  let ppo: string | null = null;
  const death = c.type === "FAMILY";
  if (w.pension.amount > 0 || (death && w.familyPension.enhanced > 0)) {
    if (!bank) throw badRequest("payroll.errors.noBankFor", undefined, { code: e.employeeCode ?? "" });
    ppo = await nextPpo(tx, c.boardId, w.pensionFrom.slice(0, 4));
    const fm = inputs.familyMember;
    const reducedFrom = addDays(w.familyPension.enhancedUntil, 1);
    const p = await tx.pensioner.create({
      data: {
        boardId: c.boardId,
        employeeId: e.id,
        ppoNumber: ppo,
        type: c.type,
        relation: death ? fm!.relation : "SELF",
        payeeName: death ? fm!.name : fullName(e),
        payeeNameHi: death ? null : e.nameHi,
        payeeDob: fromISODate(death ? fm!.dob! : toISODate(e.dateOfBirth)),
        mobile: inputs.mobile,
        email: death ? null : e.email,
        basicPension: death ? w.familyPension.enhanced : w.pension.amount,
        reducedPension: death && w.familyPension.normal < w.familyPension.enhanced ? w.familyPension.normal : null,
        reducedFrom: death && w.familyPension.normal < w.familyPension.enhanced ? fromISODate(reducedFrom) : null,
        commutedAmount: w.commutation.monthly,
        commutationDate: w.commutation.from ? fromISODate(w.commutation.from) : null,
        commutationLumpSum: w.commutation.lumpSum || null,
        fmaEligible: inputs.fmaEligible,
        startDate: fromISODate(w.pensionFrom),
        bankAccountEnc: bank.enc,
        bankAccountHash: bank.hash,
        bankAccountLast4: bank.last4,
        ifsc: bank.ifsc,
        bankName: bank.name,
        caseId: c.id,
        createdById: c.createdById,
      },
    });
    pensionerId = p.id;
  }
  await tx.pensionCase.update({ where: { id: c.id }, data: { status: "APPROVED", approvedAt: new Date(), ppoNumber: ppo, pensionerId } });
  // Someone already off the rolls (a case approved after retirement, a death in service): close the GPF account now.
  await settleGpf(tx, e.id, ppo, task.makerId);
  await audit(tx, actor, { action: "APPROVE", entityType: "PensionCase", entityId: c.id, summary: `Pension case of ${fullName(e)} approved${ppo ? ` — PPO ${ppo}, pension from ${formatDate(w.pensionFrom)}` : ""}`, newValue: { taskId: task.id, ppo, pension: w.pension.amount, familyPension: w.familyPension.enhanced, lumpSum: w.lumpSum }, sensitive: true });
  await emit(tx, c.boardId, "pension.case_approved", { type: "PensionCase", id: c.id }, { employeeId: e.id, ppo, pensionFrom: w.pensionFrom });
}

/**
 * PN-08: the GPF account is closed once the person has left the rolls and the case is approved — this year's interest to
 * the month of leaving is credited and the final payment taken out (paid from the fund). Done once.
 */
export async function settleGpf(tx: DbLike, employeeId: string, ppo: string | null, byId: string | null) {
  const e = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
  if (e.type !== "PERMANENT_OPS" || ["ACTIVE", "SUSPENDED", "DRAFT"].includes(e.status)) return null;
  if (await tx.gpfEntry.findFirst({ where: { employeeId, kind: "WITHDRAWAL", note: { startsWith: "Final payment" } } })) return null;
  const lastDay = e.exitDate ? toISODate(e.exitDate) : e.dateOfRetirement ? toISODate(e.dateOfRetirement) : null;
  if (!lastDay) return null;
  const month = lastDay.slice(0, 7);
  const { gpfFinal } = await import("./case-facts");
  const g = await gpfFinal(tx, e.boardId, employeeId, month);
  const total = fromPaise(toPaise(g.balance) + toPaise(g.interest));
  if (total <= 0) return null;
  if (g.interest > 0) await tx.gpfEntry.create({ data: { boardId: e.boardId, employeeId, month, fy: g.fy, kind: "INTEREST", amount: g.interest, note: `Interest to ${month} on the final payment`, createdById: byId } });
  await tx.gpfEntry.create({ data: { boardId: e.boardId, employeeId, month, fy: g.fy, kind: "WITHDRAWAL", amount: -total, note: `Final payment on leaving service${ppo ? ` (PPO ${ppo})` : ""}`, createdById: byId } });
  await emit(tx, e.boardId, "gpf.final_payment", { type: "Employee", id: employeeId }, { amount: total, interest: g.interest, month });
  return { amount: total, interest: g.interest };
}

/** Stores the PPO PDF once the approval is saved (the screen renders it on the spot if this has not happened). */
export async function storePpo(caseId: string) {
  const { renderPpo } = await import("./ppo");
  const { saveFile } = await import("@/lib/storage");
  const pdf = await renderPpo(caseId);
  const stored = await saveFile("ppo", pdf, "pdf");
  await db.pensionCase.update({ where: { id: caseId }, data: { ppoKey: stored.key, ppoSha: stored.sha256 } });
}

// ─── Reading ──────────────────────────────────────────────────────────────────

/** S-62 home: retirements in the next 12 months (alerts at 12 and 6), people retired without a case, and every case. */
export async function casesOverview(actor: Actor) {
  if (!canSeePension(actor)) throw forbidden();
  const today = todayIST();
  const until = addDays(today, 366);
  const [employees, cases] = await Promise.all([
    db.employee.findMany({
      where: {
        boardId: actor.boardId,
        type: { in: ["PERMANENT_OPS", "PERMANENT_NPS"] },
        OR: [
          { status: { in: ["ACTIVE", "SUSPENDED"] }, dateOfRetirement: { lte: fromISODate(until) } },
          { status: { in: ["RETIRED", "DECEASED"] }, exitDate: { gte: fromISODate(addDays(today, -366)) } },
        ],
      },
      include: { post: { select: { name: true, nameHi: true } }, section: { select: { name: true, nameHi: true } } },
      orderBy: { dateOfRetirement: "asc" },
    }),
    db.pensionCase.findMany({ where: { boardId: actor.boardId }, include: { employee: { select: { employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true } }, noDues: { select: { status: true } } }, orderBy: [{ updatedAt: "desc" }], take: 100 }),
  ]);
  const caseBy = new Map<string, (typeof cases)[number]>();
  for (const c of [...cases].reverse()) if (c.status !== "REJECTED" || !caseBy.has(c.employeeId)) caseBy.set(c.employeeId, c);
  const alerts = employees
    .map((e) => {
      const lastDay = e.exitDate ? toISODate(e.exitDate) : e.dateOfRetirement ? toISODate(e.dateOfRetirement) : null;
      if (!lastDay) return null;
      const c = caseBy.get(e.id);
      const days = daysBetweenInclusive(today, lastDay) - 1;
      const done = c && c.status === "APPROVED";
      if (days < 0 && done) return null;
      return {
        employeeId: e.id,
        code: e.employeeCode,
        name: fullName(e),
        nameHi: e.nameHi,
        post: e.post,
        section: e.section,
        scheme: e.type === "PERMANENT_OPS" ? ("OPS" as const) : ("NPS" as const),
        status: e.status,
        lastDay,
        daysLeft: days,
        stage: days < 0 ? ("RETIRED" as const) : days <= 183 ? ("SIX" as const) : ("TWELVE" as const),
        case: c ? { id: c.id, status: c.status, noDuesDone: c.noDues.filter((n) => n.status !== "PENDING").length, noDuesTotal: c.noDues.length } : null,
        isSelf: e.id === actor.employeeId,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  return {
    alerts,
    cases: cases.map((c) => {
      const w = c.working as unknown as StoredWorking;
      return { id: c.id, status: c.status, type: c.type, employeeId: c.employeeId, code: c.employee.employeeCode, name: fullName(c.employee), nameHi: c.employee.nameHi, lastDay: toISODate(c.retirementDate), pension: w.pension?.amount ?? 0, familyPension: w.familyPension?.enhanced ?? 0, lumpSum: w.lumpSum ?? 0, ppoNumber: c.ppoNumber, updatedAt: c.updatedAt.toISOString() };
    }),
    canManage: canManagePension(actor),
  };
}

/** Everything the S-62 case screen shows. */
export async function getCase(actor: Actor, id: string) {
  if (!canSeePension(actor)) throw forbidden();
  const c = await loadCase(actor, id);
  const [sections, tasks, benefits] = await Promise.all([
    db.section.findMany({ where: { id: { in: c.noDues.map((n) => n.sectionId) } }, select: { id: true, name: true, nameHi: true } }),
    db.approvalTask.findMany({ where: { boardId: actor.boardId, kind: "pension.case", entityId: id }, orderBy: { createdAt: "asc" } }),
    c.benefitsRunId ? db.payrollRun.findUnique({ where: { id: c.benefitsRunId }, select: { id: true, status: true, net: true, month: true, seq: true } }) : null,
  ]);
  const sectionBy = new Map(sections.map((s) => [s.id, s]));
  const inputs = c.inputs as unknown as CaseInputs;
  const working = c.working as unknown as StoredWorking;
  const pending = tasks.find((t) => t.status === "PENDING") ?? null;
  const lastReturn = [...tasks].reverse().find((t) => t.status === "RETURNED" || t.status === "REJECTED") ?? null;
  const own = c.employeeId === actor.employeeId;
  return {
    case: { id: c.id, status: c.status, type: c.type, lastDay: toISODate(c.retirementDate), ppoNumber: c.ppoNumber, pensionerId: c.pensionerId, approvedAt: c.approvedAt, createdByName: c.createdByName, createdAt: c.createdAt.toISOString(), hasPpo: Boolean(c.ppoKey) || c.status === "APPROVED" },
    employee: {
      id: c.employee.id,
      code: c.employee.employeeCode,
      name: fullName(c.employee),
      nameHi: c.employee.nameHi,
      dob: toISODate(c.employee.dateOfBirth),
      doj: toISODate(c.employee.dateOfJoining),
      dateOfRetirement: c.employee.dateOfRetirement ? toISODate(c.employee.dateOfRetirement) : null,
      status: c.employee.status,
      type: c.employee.type,
      post: { name: c.employee.post.name, nameHi: c.employee.post.nameHi },
      section: { name: c.employee.section.name, nameHi: c.employee.section.nameHi },
      bankLast4: c.employee.bankAccountLast4,
      mobile: c.employee.mobile,
    },
    family: c.employee.family.map((m) => ({ id: m.id, name: m.name, relation: m.relation, dob: m.dateOfBirth ? toISODate(m.dateOfBirth) : null })),
    inputs: { ...inputs, bank: inputs.bank ? { last4: inputs.bank.last4, ifsc: inputs.bank.ifsc, name: inputs.bank.name } : null },
    working,
    noDues: c.noDues
      .map((n) => ({ sectionId: n.sectionId, name: sectionBy.get(n.sectionId)?.name ?? "", nameHi: sectionBy.get(n.sectionId)?.nameHi ?? "", status: n.status, amount: num(n.amount), note: n.note, byName: n.byName, at: n.at?.toISOString() ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    task: pending ? { id: pending.id, step: (pending.payload as { step?: string }).step === "approver" ? "approver" : "checker", makerName: pending.makerName } : null,
    lastReturn: lastReturn ? { status: lastReturn.status, by: lastReturn.deciderName, note: lastReturn.decisionNote } : null,
    benefits: benefits ? { id: benefits.id, status: benefits.status, net: num(benefits.net), month: benefits.month } : null,
    can: {
      edit: !own && canManagePension(actor) && c.status === "DRAFT",
      submit: !own && canManagePension(actor) && c.status === "DRAFT",
      benefits: !own && canManagePension(actor) && c.status === "APPROVED" && !benefits && working.lumpSum > 0,
    },
  };
}

/** PN-09: the PPO PDF of an approved case (stored at approval; made again if it was not). */
export async function casePpo(actor: Actor, id: string) {
  const own = await db.pensionCase.findFirst({ where: { id, boardId: actor.boardId }, select: { pensionerId: true } });
  if (!own) throw notFound();
  if (!canSeePension(actor) && !(own.pensionerId && own.pensionerId === actor.pensionerId)) throw forbidden();
  const c = await loadCase(actor, id);
  if (c.status !== "APPROVED") throw conflict("pension.errors.caseNotApproved");
  const { loadFile } = await import("@/lib/storage");
  const pdf = c.ppoKey ? await loadFile(c.ppoKey) : await (await import("./ppo")).renderPpo(c.id);
  await audit(db, actor, { action: "PRINT", entityType: "PensionCase", entityId: c.id, summary: `Downloaded the PPO ${c.ppoNumber ?? ""} of ${fullName(c.employee)}`, sensitive: true });
  return { pdf, fileName: `PPO-${(c.ppoNumber ?? c.id).replace(/\//g, "-")}.pdf` };
}

/** People a case can be started for (or a death in service recorded): permanent staff without a case under way. */
export async function caseCandidates(actor: Actor) {
  if (!canManagePension(actor)) throw forbidden();
  const today = todayIST();
  const rows = await db.employee.findMany({
    where: {
      boardId: actor.boardId,
      type: { in: ["PERMANENT_OPS", "PERMANENT_NPS"] },
      id: actor.employeeId ? { not: actor.employeeId } : undefined,
      OR: [{ status: { in: ["ACTIVE", "SUSPENDED"] } }, { status: { in: ["RETIRED", "DECEASED"] }, exitDate: { gte: fromISODate(addDays(today, -730)) } }],
      pensionCases: { none: { status: { in: [...OPEN, "APPROVED"] } } },
    },
    include: { family: { orderBy: { createdAt: "asc" } } },
    orderBy: [{ dateOfRetirement: "asc" }, { employeeCode: "asc" }],
  });
  return rows.map((e) => ({
    id: e.id,
    code: e.employeeCode,
    name: fullName(e),
    nameHi: e.nameHi,
    scheme: e.type === "PERMANENT_OPS" ? ("OPS" as const) : ("NPS" as const),
    status: e.status,
    dateOfRetirement: e.dateOfRetirement ? toISODate(e.dateOfRetirement) : null,
    exitDate: e.exitDate ? toISODate(e.exitDate) : null,
    bankLast4: e.bankAccountLast4,
    mobile: e.mobile,
    family: e.family.map((m) => ({ id: m.id, name: m.name, relation: m.relation, dob: m.dateOfBirth ? toISODate(m.dateOfBirth) : null })),
  }));
}
