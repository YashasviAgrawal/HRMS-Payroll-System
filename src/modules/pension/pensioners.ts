import "server-only";
import { z } from "zod";
import type { ApprovalTask, Prisma } from "@/generated/prisma/client";
import { canOpenTask, submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import { can, canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { seal } from "@/lib/crypto";
import { db, type Tx } from "@/lib/db";
import { addDays, formatDate, fromISODate, todayIST, toISODate, type ISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { formatINR } from "@/lib/money";
import { emit } from "@/lib/outbox";
import { isoDateField, isValidBankAccount, isValidIfsc, MOBILE_RE } from "@/lib/validators";
import { fullName } from "@/modules/employees/present";
import { additionalPensionPct, ageOn, lifeCertificateHoldFrom, lifeCertificateState, lifeCertificateValidTill, PENSION_TYPE_LABEL, restorationDate, type LifeCertState } from "./rules";

/**
 * S-60, PN-01: pensioners — the list, each pensioner's record (PPO, kind of pension, basic pension, commutation, date of
 * birth, bank, family), life certificate status, and changes to the record through a Checker.
 */
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;
export const canSeePension = (actor: Actor) => canAll(actor, "pension", "view");
export const canManagePension = (actor: Actor) => canAll(actor, "pension", "create");

export type LcView = { validTill: ISODate; state: LifeCertState; holdFrom: ISODate; lastOn: ISODate | null; waiting: number };

/** Life certificate status from the latest verified certificate (or the pension's start), and any waiting to be checked. */
export function lcViewOf(p: { startDate: Date; lifeCertificates: { certifiedOn: Date; status: string }[] }, today: ISODate = todayIST()): LcView {
  const verified = p.lifeCertificates.filter((c) => c.status === "VERIFIED").sort((a, b) => b.certifiedOn.getTime() - a.certifiedOn.getTime())[0];
  const lastOn = verified ? toISODate(verified.certifiedOn) : null;
  const validTill = lifeCertificateValidTill(lastOn ?? toISODate(p.startDate));
  return { validTill, state: lifeCertificateState(validTill, today), holdFrom: lifeCertificateHoldFrom(validTill), lastOn, waiting: p.lifeCertificates.filter((c) => c.status === "SUBMITTED").length };
}

export const LC_STATES = ["VALID", "DUE_SOON", "OVERDUE", "HELD"] as const;

export interface PensionerFilters {
  q?: string;
  status?: "ACTIVE" | "STOPPED" | "ALL";
  lc?: LifeCertState | "WAITING";
}

/** S-60 list: every pensioner with the pension now, life certificate status and last pension paid. */
export async function listPensioners(actor: Actor, f: PensionerFilters = {}) {
  if (!canSeePension(actor)) throw forbidden();
  const q = f.q?.trim();
  const rows = await db.pensioner.findMany({
    where: {
      boardId: actor.boardId,
      ...(f.status === "ALL" ? {} : { status: f.status === "STOPPED" ? "STOPPED" : "ACTIVE" }),
      ...(q ? { OR: [{ ppoNumber: { contains: q, mode: "insensitive" } }, { payeeName: { contains: q, mode: "insensitive" } }, { employee: { employeeCode: { contains: q, mode: "insensitive" } } }, { mobile: { contains: q } }] } : {}),
    },
    include: {
      employee: { select: { employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, post: { select: { name: true, nameHi: true } } } },
      lifeCertificates: { select: { certifiedOn: true, status: true } },
    },
    orderBy: { ppoNumber: "asc" },
  });
  const last = await db.payslip.findMany({
    where: { pensionerId: { in: rows.map((r) => r.id) }, run: { payGroup: "PENSION", kind: "REGULAR", status: { in: [...PAID] } } },
    select: { pensionerId: true, month: true, net: true, status: true },
    orderBy: { month: "desc" },
  });
  const lastBy = new Map<string, (typeof last)[number]>();
  for (const s of last) if (!lastBy.has(s.pensionerId!)) lastBy.set(s.pensionerId!, s);
  const today = todayIST();
  const list = rows.map((p) => {
    const lc = lcViewOf(p, today);
    const l = lastBy.get(p.id);
    return {
      id: p.id,
      ppoNumber: p.ppoNumber,
      type: p.type,
      relation: p.relation,
      status: p.status,
      payee: p.payeeName,
      payeeHi: p.payeeNameHi,
      mobile: p.mobile,
      age: ageOn(toISODate(p.payeeDob), today),
      of: p.relation === "SELF" ? null : fullName(p.employee),
      employeeCode: p.employee.employeeCode,
      basic: num(p.basicPension),
      commuted: num(p.commutedAmount),
      restoredOn: p.commutationDate && num(p.commutedAmount) > 0 ? restorationDate(toISODate(p.commutationDate)) : null,
      commutedNow: Boolean(p.commutationDate && num(p.commutedAmount) > 0 && restorationDate(toISODate(p.commutationDate)) > today),
      startDate: toISODate(p.startDate),
      endDate: p.endDate ? toISODate(p.endDate) : null,
      lc,
      lastPaid: l ? { month: l.month, net: num(l.net), held: l.status === "WITHHELD" } : null,
    };
  });
  const filtered = list.filter((p) => !f.lc || (f.lc === "WAITING" ? p.lc.waiting > 0 : p.status === "ACTIVE" && p.lc.state === f.lc));
  const active = list.filter((p) => p.status === "ACTIVE");
  return {
    rows: filtered,
    counts: {
      active: active.length,
      stopped: list.length - active.length,
      dueSoon: active.filter((p) => p.lc.state === "DUE_SOON").length,
      overdue: active.filter((p) => p.lc.state === "OVERDUE").length,
      held: active.filter((p) => p.lc.state === "HELD").length,
      waiting: list.filter((p) => p.lc.waiting > 0).length,
    },
    canManage: canManagePension(actor),
  };
}

async function loadPensioner(actor: Actor, id: string) {
  const p = await db.pensioner.findFirst({
    where: { id, boardId: actor.boardId },
    include: {
      employee: { include: { post: { select: { name: true, nameHi: true } }, section: { select: { name: true, nameHi: true } }, family: { orderBy: { createdAt: "asc" } } } },
      lifeCertificates: { orderBy: { certifiedOn: "desc" } },
    },
  });
  if (!p) throw notFound();
  return p;
}

/** S-60 profile — HR & Accounts, or the pensioner themself (PN-12). */
export async function pensionerProfile(actor: Actor, id: string) {
  const own = actor.pensionerId === id;
  if (!own && !canSeePension(actor)) throw forbidden();
  const p = await loadPensioner(actor, id);
  const today = todayIST();
  const [slips, history, items, pending, rates] = await Promise.all([
    db.payslip.findMany({
      where: { pensionerId: id, run: { payGroup: "PENSION", status: { in: own ? ["PAID", "CLOSED"] : [...PAID] } } },
      include: { run: { select: { kind: true, seq: true, month: true, source: true, payGroup: true, status: true } } },
      orderBy: [{ month: "desc" }, { createdAt: "desc" }],
      take: 12,
    }),
    db.pensioner.findMany({ where: { employeeId: p.employeeId, id: { not: id } }, select: { id: true, ppoNumber: true, payeeName: true, payeeNameHi: true, relation: true, type: true, status: true, startDate: true, endDate: true, endReason: true }, orderBy: { startDate: "asc" } }),
    own ? Promise.resolve([]) : db.employeePayItem.findMany({ where: { employeeId: p.employeeId, headCode: { in: ["RECOVERY", "COURT"] }, OR: [{ toMonth: null }, { toMonth: { gte: today.slice(0, 7) } }] }, orderBy: { fromMonth: "asc" } }),
    db.approvalTask.findMany({ where: { boardId: actor.boardId, status: "PENDING", kind: { in: ["pension.record", "pension.lifecert", "pension.death"] }, entityId: id }, select: { id: true, kind: true, title: true, titleHi: true, makerName: true, createdAt: true, requiredPermission: true, makerId: true, deciderId: true } }),
    db.payRate.findMany({ where: { boardId: actor.boardId, effectiveFrom: { lte: fromISODate(`${today.slice(0, 7)}-01`) } }, orderBy: { effectiveFrom: "asc" } }),
  ]);
  const r: Record<string, number> = {};
  for (const x of rates) r[x.key] = num(x.value);
  const lc = lcViewOf(p, today);
  const commuted = num(p.commutedAmount);
  const restoredOn = p.commutationDate && commuted > 0 ? restorationDate(toISODate(p.commutationDate)) : null;
  return {
    pensioner: {
      id: p.id,
      ppoNumber: p.ppoNumber,
      type: p.type,
      typeLabel: PENSION_TYPE_LABEL[p.type] ?? [p.type, p.type],
      relation: p.relation,
      status: p.status,
      payee: p.payeeName,
      payeeHi: p.payeeNameHi,
      payeeDob: toISODate(p.payeeDob),
      age: ageOn(toISODate(p.payeeDob), today),
      addlPct: additionalPensionPct(toISODate(p.payeeDob), today.slice(0, 7), r),
      mobile: p.mobile,
      email: p.email,
      basic: num(p.basicPension),
      reduced: p.reducedPension === null ? null : { amount: num(p.reducedPension), from: toISODate(p.reducedFrom!) },
      commuted,
      commutationDate: p.commutationDate ? toISODate(p.commutationDate) : null,
      commutationLumpSum: p.commutationLumpSum === null ? null : num(p.commutationLumpSum),
      restoredOn,
      restored: restoredOn !== null && restoredOn <= today,
      fma: p.fmaEligible,
      startDate: toISODate(p.startDate),
      endDate: p.endDate ? toISODate(p.endDate) : null,
      endReason: p.endReason,
      bank: { last4: p.bankAccountLast4, ifsc: p.ifsc, name: p.bankName },
      drRate: r.DA_PERCENT ?? 0,
    },
    employee: {
      id: p.employee.id,
      code: p.employee.employeeCode,
      name: fullName(p.employee),
      nameHi: p.employee.nameHi,
      status: p.employee.status,
      post: p.employee.post,
      section: p.employee.section,
      dateOfJoining: toISODate(p.employee.dateOfJoining),
      lastDay: p.employee.exitDate ? toISODate(p.employee.exitDate) : p.employee.dateOfRetirement ? toISODate(p.employee.dateOfRetirement) : null,
    },
    family: p.employee.family.map((m) => ({ id: m.id, name: m.name, relation: m.relation, dob: m.dateOfBirth ? toISODate(m.dateOfBirth) : null, dependent: m.isDependent })),
    lc,
    certificates: p.lifeCertificates.map((c) => ({ id: c.id, source: c.source, status: c.status, certifiedOn: toISODate(c.certifiedOn), jpId: c.jpId, fileName: c.fileName, hasFile: Boolean(c.fileKey), note: c.note, verifiedAt: c.verifiedAt })),
    slips: slips.map((s) => ({ id: s.id, month: s.month, kind: s.run.kind, status: s.status, runStatus: s.run.status, gross: num(s.gross), deductions: num(s.deductions), net: num(s.net), catchUp: ((s.detail ?? {}) as { catchUp?: { month: string }[] }).catchUp?.map((c) => c.month) ?? [] })),
    history: history.map((h) => ({ ...h, startDate: toISODate(h.startDate), endDate: h.endDate ? toISODate(h.endDate) : null })),
    recoveries: items.map((i) => ({ id: i.id, headCode: i.headCode, amount: num(i.amount), fromMonth: i.fromMonth, toMonth: i.toMonth, note: i.note })),
    pending: pending.map(({ requiredPermission, makerId, deciderId, ...t }) => ({ ...t, createdAt: t.createdAt.toISOString(), canOpen: canOpenTask(actor, { requiredPermission, makerId, deciderId }) })),
    own,
    can: {
      manage: !own && canManagePension(actor),
      verify: !own && can(actor, "pension", "create"),
    },
  };
}

// ─── Changes to the record (PN-01) — Pension proposes, a Checker approves ─────

const money = z.coerce.number().min(0, "validation.notNegative").max(10_000_000, "validation.tooBig");
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

export const pensionerEditSchema = z
  .object({
    payeeName: z.string().trim().min(2, "validation.tooShort").max(120),
    payeeNameHi: optText(120),
    mobile: z.string().trim().optional().transform((v) => v || null).refine((v) => !v || MOBILE_RE.test(v), "validation.mobile"),
    email: z.string().trim().optional().transform((v) => v || null).refine((v) => !v || z.string().email().safeParse(v).success, "validation.email"),
    bankAccount: z.string().optional().transform((v) => (v ? v.replace(/\s/g, "") : null)).refine((v) => !v || isValidBankAccount(v), "validation.bankAccount"),
    ifsc: z.string().trim().toUpperCase().optional().transform((v) => v || null).refine((v) => !v || isValidIfsc(v), "validation.ifsc"),
    bankName: optText(100),
    fmaEligible: z.boolean(),
    basicPension: money,
    reducedPension: money.nullable().optional(),
    reducedFrom: isoDateField.nullable().optional(),
    commutedAmount: money,
    commutationDate: isoDateField.nullable().optional(),
    reason: z.string().trim().min(3, "validation.tooShort").max(300),
  })
  .superRefine((v, ctx) => {
    if (v.bankAccount && !v.ifsc) ctx.addIssue({ code: "custom", path: ["ifsc"], message: "validation.required" });
    if (v.commutedAmount > 0 && !v.commutationDate) ctx.addIssue({ code: "custom", path: ["commutationDate"], message: "validation.required" });
    if (v.commutedAmount > v.basicPension * 0.4 + 1) ctx.addIssue({ code: "custom", path: ["commutedAmount"], message: "pension.errors.commutedTooMuch" });
    if ((v.reducedPension ?? null) !== null && !v.reducedFrom) ctx.addIssue({ code: "custom", path: ["reducedFrom"], message: "validation.required" });
  });

type PensionerData = {
  payeeName?: string;
  payeeNameHi?: string | null;
  mobile?: string | null;
  email?: string | null;
  bankAccountEnc?: string;
  bankAccountHash?: string;
  bankAccountLast4?: string;
  ifsc?: string | null;
  bankName?: string | null;
  fmaEligible?: boolean;
  basicPension?: number;
  reducedPension?: number | null;
  reducedFrom?: string | null;
  commutedAmount?: number;
  commutationDate?: string | null;
};

const LABELS: Record<string, [string, string]> = {
  payeeName: ["Pensioner's name", "पेंशनभोगी का नाम"],
  payeeNameHi: ["Name in Hindi", "हिंदी में नाम"],
  mobile: ["Mobile", "मोबाइल"],
  email: ["Email", "ईमेल"],
  bankAccount: ["Bank account", "बैंक खाता"],
  ifsc: ["IFSC", "आईएफएससी"],
  bankName: ["Bank", "बैंक"],
  fmaEligible: ["Fixed medical allowance", "नियत चिकित्सा भत्ता"],
  basicPension: ["Basic pension", "मूल पेंशन"],
  reducedPension: ["Pension after the enhanced period", "बढ़ी दर की अवधि के बाद पेंशन"],
  reducedFrom: ["Lower rate from", "कम दर कब से"],
  commutedAmount: ["Commuted part a month", "मासिक रूपांतरित भाग"],
  commutationDate: ["Commutation date", "रूपांतरण तिथि"],
};

const show = (key: string, v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : ["basicPension", "reducedPension", "commutedAmount"].includes(key) ? formatINR(Number(v)) : ["reducedFrom", "commutationDate"].includes(key) ? formatDate(String(v) as ISODate) : String(v);

/** PN-01: a change to a pensioner's record goes to a Checker. Only what changed is sent; fields left out stay as they are. */
export async function proposePensionerEdit(actor: Actor, id: string, raw: unknown) {
  if (!canManagePension(actor)) throw forbidden();
  const input = pensionerEditSchema.parse(raw);
  const sent = new Set(Object.keys((raw ?? {}) as object));
  const p = await loadPensioner(actor, id);
  if (p.employeeId === actor.employeeId) throw forbidden("errors.ownPay");
  const before: Record<string, unknown> = {
    payeeName: p.payeeName,
    payeeNameHi: p.payeeNameHi,
    mobile: p.mobile,
    email: p.email,
    ifsc: p.ifsc,
    bankName: p.bankName,
    fmaEligible: p.fmaEligible,
    basicPension: num(p.basicPension),
    reducedPension: p.reducedPension === null ? null : num(p.reducedPension),
    reducedFrom: p.reducedFrom ? toISODate(p.reducedFrom) : null,
    commutedAmount: num(p.commutedAmount),
    commutationDate: p.commutationDate ? toISODate(p.commutationDate) : null,
  };
  const after: Record<string, unknown> = { ...input, reducedPension: input.reducedPension ?? null, reducedFrom: input.reducedFrom ?? null, commutationDate: input.commutationDate ?? null };
  const data: PensionerData = {};
  const rows: NonNullable<ApprovalDetails["rows"]> = [];
  for (const key of Object.keys(before)) {
    // IFSC and bank name change with the account, or on their own when typed.
    if (!sent.has(key) || ((key === "ifsc" || key === "bankName") && !input.bankAccount && !after[key])) continue;
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    (data as Record<string, unknown>)[key] = after[key];
    rows.push({ label: LABELS[key][0], labelHi: LABELS[key][1], old: show(key, before[key]), new: show(key, after[key]) });
  }
  if (input.bankAccount) {
    const sealed = seal("bank", input.bankAccount);
    if (sealed.hash !== p.bankAccountHash) {
      Object.assign(data, { bankAccountEnc: sealed.enc, bankAccountHash: sealed.hash, bankAccountLast4: sealed.last4 });
      rows.push({ label: LABELS.bankAccount[0], labelHi: LABELS.bankAccount[1], old: p.bankAccountLast4 ? `••••${p.bankAccountLast4}` : "—", new: `••••${sealed.last4}`, reveal: "bankAccount" });
    }
  }
  if (!rows.length) throw badRequest("employees.errors.noChanges");
  return db.$transaction(async (tx) => {
    if (await tx.approvalTask.count({ where: { boardId: actor.boardId, kind: "pension.record", entityId: id, status: "PENDING" } })) throw conflict("pension.errors.changeWaiting");
    const task = await submitForApproval(tx, actor, {
      kind: "pension.record",
      title: `Change to pension record ${p.ppoNumber} — ${p.payeeName}`,
      titleHi: `पेंशन अभिलेख ${p.ppoNumber} में बदलाव — ${p.payeeNameHi ?? p.payeeName}`,
      details: { rows, summary: input.reason, link: `/pension/pensioners/${id}` },
      payload: { pensionerId: id, data, reason: input.reason },
      subjectEmployeeId: p.employeeId,
      entityType: "Pensioner",
      entityId: id,
      note: input.reason,
    });
    return task;
  });
}

/** Saves an approved change to a pensioner's record. */
export async function applyPensionerEdit(tx: Tx, task: ApprovalTask, actor: Actor, payload: { pensionerId: string; data: PensionerData; reason: string }) {
  const d = payload.data;
  const update: Prisma.PensionerUpdateInput = {
    ...d,
    reducedFrom: d.reducedFrom === undefined ? undefined : d.reducedFrom ? fromISODate(d.reducedFrom) : null,
    commutationDate: d.commutationDate === undefined ? undefined : d.commutationDate ? fromISODate(d.commutationDate) : null,
  };
  const p = await tx.pensioner.update({ where: { id: payload.pensionerId }, data: update });
  await audit(tx, actor, { action: "UPDATE", entityType: "Pensioner", entityId: p.id, summary: `Pension record ${p.ppoNumber} changed (${Object.keys(d).filter((k) => !k.endsWith("Hash") && !k.endsWith("Last4")).join(", ")})`, newValue: { taskId: task.id, fields: Object.keys(d) }, sensitive: true });
  await emit(tx, p.boardId, "pension.record_changed", { type: "Pensioner", id: p.id }, { fields: Object.keys(d) });
}

// ─── A pensioner from the old records (PN-01) ────────────────────────────────

export const newPensionerSchema = z
  .object({
    employeeId: z.string().min(1, "validation.required"),
    ppoNumber: z.string().trim().min(3, "validation.tooShort").max(40).transform((v) => v.toUpperCase()),
    type: z.enum(["SUPERANNUATION", "VOLUNTARY", "INVALID", "COMPULSORY", "FAMILY"]),
    relation: z.enum(["SELF", "SPOUSE", "SON", "DAUGHTER", "MOTHER", "FATHER", "OTHER"]),
    payeeName: z.string().trim().min(2, "validation.tooShort").max(120),
    payeeNameHi: optText(120),
    payeeDob: isoDateField,
    mobile: z.string().trim().optional().transform((v) => v || null).refine((v) => !v || MOBILE_RE.test(v), "validation.mobile"),
    bankAccount: z.string().transform((v) => v.replace(/\s/g, "")).refine(isValidBankAccount, "validation.bankAccount"),
    ifsc: z.string().trim().toUpperCase().refine(isValidIfsc, "validation.ifsc"),
    bankName: optText(100),
    basicPension: money.refine((v) => v > 0, "validation.required"),
    reducedPension: money.nullable().optional(),
    reducedFrom: isoDateField.nullable().optional(),
    commutedAmount: money,
    commutationDate: isoDateField.nullable().optional(),
    fmaEligible: z.boolean(),
    startDate: isoDateField,
    lastCertificate: isoDateField.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.type === "FAMILY") !== (v.relation !== "SELF")) ctx.addIssue({ code: "custom", path: ["relation"], message: "pension.errors.relationType" });
    if (v.commutedAmount > 0 && !v.commutationDate) ctx.addIssue({ code: "custom", path: ["commutationDate"], message: "validation.required" });
    if ((v.reducedPension ?? null) !== null && !v.reducedFrom) ctx.addIssue({ code: "custom", path: ["reducedFrom"], message: "validation.required" });
    if (v.startDate > todayIST()) ctx.addIssue({ code: "custom", path: ["startDate"], message: "validation.notFuture" });
  });

/** A pensioner of the old system not yet on the rolls here: Pension enters, a Checker approves. */
export async function proposeNewPensioner(actor: Actor, raw: unknown) {
  if (!canManagePension(actor)) throw forbidden();
  const input = newPensionerSchema.parse(raw);
  const e = await db.employee.findFirst({ where: { id: input.employeeId, boardId: actor.boardId } });
  if (!e) throw notFound();
  if (e.id === actor.employeeId) throw forbidden("errors.ownPay");
  if (["ACTIVE", "SUSPENDED", "DRAFT"].includes(e.status)) throw badRequest("errors.validation", { employeeId: "pension.errors.stillServing" });
  if (await db.pensioner.findFirst({ where: { boardId: actor.boardId, ppoNumber: input.ppoNumber } })) throw badRequest("errors.validation", { ppoNumber: "pension.errors.ppoTaken" });
  if (await db.pensioner.findFirst({ where: { employeeId: e.id, status: "ACTIVE" } })) throw badRequest("errors.validation", { employeeId: "pension.errors.alreadyPaid" });
  const bank = seal("bank", input.bankAccount);
  const data = { ...input, bankAccount: undefined, bankAccountEnc: bank.enc, bankAccountHash: bank.hash, bankAccountLast4: bank.last4 };
  const rows: NonNullable<ApprovalDetails["rows"]> = [
    { label: "PPO number", labelHi: "पीपीओ संख्या", new: input.ppoNumber },
    { label: "Pension of", labelHi: "किसकी पेंशन", new: `${fullName(e)} (${e.employeeCode ?? "—"})` },
    { label: "Kind of pension", labelHi: "पेंशन का प्रकार", new: PENSION_TYPE_LABEL[input.type][0] },
    { label: "Paid to", labelHi: "भुगतान किसे", new: `${input.payeeName} (${input.relation})` },
    { label: LABELS.basicPension[0], labelHi: LABELS.basicPension[1], new: formatINR(input.basicPension) },
    { label: LABELS.commutedAmount[0], labelHi: LABELS.commutedAmount[1], new: input.commutedAmount ? `${formatINR(input.commutedAmount)} from ${formatDate(input.commutationDate!)}` : "—" },
    { label: "Pension from", labelHi: "पेंशन कब से", new: formatDate(input.startDate) },
    { label: LABELS.bankAccount[0], labelHi: LABELS.bankAccount[1], new: `••••${bank.last4} · ${input.ifsc}`, reveal: "bankAccount" },
  ];
  return db.$transaction((tx) =>
    submitForApproval(tx, actor, {
      kind: "pension.record",
      title: `New pensioner ${input.ppoNumber} — ${input.payeeName}`,
      titleHi: `नया पेंशनभोगी ${input.ppoNumber} — ${input.payeeNameHi ?? input.payeeName}`,
      details: { rows, summary: "Pensioner brought over from the old records" },
      payload: { create: true, data },
      subjectEmployeeId: e.id,
      entityType: "Pensioner",
      note: null,
    }),
  );
}

export async function applyNewPensioner(tx: Tx, task: ApprovalTask, actor: Actor, data: z.infer<typeof newPensionerSchema> & { bankAccountEnc: string; bankAccountHash: string; bankAccountLast4: string }) {
  if (await tx.pensioner.findFirst({ where: { boardId: actor.boardId, ppoNumber: data.ppoNumber } })) throw conflict("pension.errors.ppoTaken");
  const p = await tx.pensioner.create({
    data: {
      boardId: actor.boardId,
      employeeId: data.employeeId,
      ppoNumber: data.ppoNumber,
      type: data.type,
      relation: data.relation,
      payeeName: data.payeeName,
      payeeNameHi: data.payeeNameHi,
      payeeDob: fromISODate(data.payeeDob),
      mobile: data.mobile,
      basicPension: data.basicPension,
      reducedPension: data.reducedPension ?? null,
      reducedFrom: data.reducedFrom ? fromISODate(data.reducedFrom) : null,
      commutedAmount: data.commutedAmount,
      commutationDate: data.commutationDate ? fromISODate(data.commutationDate) : null,
      fmaEligible: data.fmaEligible,
      startDate: fromISODate(data.startDate),
      bankAccountEnc: data.bankAccountEnc,
      bankAccountHash: data.bankAccountHash,
      bankAccountLast4: data.bankAccountLast4,
      ifsc: data.ifsc,
      bankName: data.bankName,
      createdById: task.makerId,
    },
  });
  if (data.lastCertificate) {
    await tx.lifeCertificate.create({ data: { boardId: actor.boardId, pensionerId: p.id, source: "MANUAL", status: "VERIFIED", certifiedOn: fromISODate(data.lastCertificate), note: "From the old records", enteredById: task.makerId, verifiedById: actor.userId, verifiedAt: new Date() } });
  }
  await tx.approvalTask.update({ where: { id: task.id }, data: { entityId: p.id } });
  await audit(tx, actor, { action: "CREATE", entityType: "Pensioner", entityId: p.id, summary: `Pensioner ${p.ppoNumber} (${p.payeeName}) added from the old records`, sensitive: true });
  await emit(tx, p.boardId, "pension.pensioner_added", { type: "Pensioner", id: p.id }, { ppoNumber: p.ppoNumber });
}

/** Employees whose service can carry a pension brought over from the old records (retired or died; none running). */
export async function pensionableFormer(actor: Actor) {
  if (!canManagePension(actor)) throw forbidden();
  const rows = await db.employee.findMany({
    where: { boardId: actor.boardId, status: { in: ["RETIRED", "DECEASED"] }, type: "PERMANENT_OPS", pensions: { none: { status: "ACTIVE" } } },
    select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, status: true, exitDate: true },
    orderBy: { employeeCode: "asc" },
  });
  return rows.map((e) => ({ id: e.id, code: e.employeeCode, name: fullName(e), nameHi: e.nameHi, status: e.status, lastDay: e.exitDate ? toISODate(e.exitDate) : null, startDate: e.exitDate ? addDays(toISODate(e.exitDate), 1) : null }));
}
