import "server-only";
import { z } from "zod";
import type { ApprovalTask, Prisma } from "@/generated/prisma/client";
import { submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/session";
import { seal } from "@/lib/crypto";
import { db, type DbLike, type Tx } from "@/lib/db";
import { addDays, addYears, formatDate, fromISODate, shiftMonth, todayIST, toISODate, type ISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { formatINR, fromPaise, toPaise } from "@/lib/money";
import { emit } from "@/lib/outbox";
import { isoDateField, isValidBankAccount, isValidIfsc, MOBILE_RE } from "@/lib/validators";
import { fullName } from "@/modules/employees/present";
import { COMPARED, drawnByMonth } from "./bills";
import { settleGpf, workCase, type CaseInputs, type StoredWorking } from "./cases";
import { factsOf, pensionHeads } from "./compute";
import { canManagePension } from "./pensioners";
import { computePension } from "./rules";

/**
 * PN-10: the day after retirement the employee leaves the rolls (status Retired, last day recorded, a service book
 * entry) and, with an approved case, is paid in the pension bill from that day. PN-11: a death — of a pensioner or of an
 * employee in service — is recorded by the Pension clerk and approved by a Checker: the pension (or pay) stops, family
 * pension starts the next day, and anything paid for days after the death is recovered (from the family pension, or
 * from the benefits on a death in service).
 */
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;

const retiredOn = new Map<string, ISODate>();

/** PN-10: moves everyone whose retirement date has passed off the rolls. Runs once a day, on the first page opened. */
export async function applyRetirements(boardId: string, today: ISODate = todayIST()) {
  if (retiredOn.get(boardId) === today) return 0;
  retiredOn.set(boardId, today);
  const due = await db.employee.findMany({ where: { boardId, status: { in: ["ACTIVE", "SUSPENDED"] }, dateOfRetirement: { lt: fromISODate(today) } } });
  for (const e of due) {
    const lastDay = toISODate(e.dateOfRetirement!);
    await db.$transaction(async (tx) => {
      const fresh = await tx.employee.updateMany({ where: { id: e.id, status: { in: ["ACTIVE", "SUSPENDED"] } }, data: { status: "RETIRED", exitDate: e.dateOfRetirement, exitReason: "Superannuation" } });
      if (!fresh.count) return;
      await tx.serviceBookEntry.create({ data: { employeeId: e.id, event: "RETIREMENT", eventDate: e.dateOfRetirement!, details: `Retired on superannuation on ${formatDate(lastDay)}.`, detailsHi: `${formatDate(lastDay, "hi")} को अधिवर्षिता पर सेवानिवृत्त।`, status: "APPROVED", createdById: "system" } });
      await audit(tx, { boardId, name: "System (retirements)" }, { action: "UPDATE", entityType: "Employee", entityId: e.id, summary: `${fullName(e)} retired on ${formatDate(lastDay)} and left the rolls`, category: "SYSTEM" });
      // With the case approved, the GPF account is closed the day after retirement (PN-08).
      const approved = await tx.pensionCase.findFirst({ where: { employeeId: e.id, status: "APPROVED" }, select: { ppoNumber: true } });
      if (approved) await settleGpf(tx, e.id, approved.ppoNumber, null);
      await emit(tx, boardId, "employee.retired", { type: "Employee", id: e.id }, { lastDay });
    });
  }
  return due.length;
}

/** For tests: forget that today's retirements were applied. */
export function resetRetirementCheck() {
  retiredOn.clear();
}

// ─── Deaths (PN-11) ───────────────────────────────────────────────────────────

const RELATIONS = ["SPOUSE", "SON", "DAUGHTER", "MOTHER", "FATHER", "OTHER"] as const;
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

export const deathSchema = z
  .object({
    dateOfDeath: isoDateField,
    note: z.string().trim().min(3, "validation.tooShort").max(300),
    /** Who the family pension goes to next; none when nobody is eligible. */
    nextPayee: z.boolean().default(true),
    familyMemberId: z.string().nullable().optional(),
    payeeName: optText(120),
    relation: z.enum(RELATIONS).nullable().optional(),
    payeeDob: isoDateField.nullable().optional(),
    mobile: z.string().trim().optional().transform((v) => v || null).refine((v) => !v || MOBILE_RE.test(v), "validation.mobile"),
    bankAccount: z.string().optional().transform((v) => (v ? v.replace(/\s/g, "") : null)).refine((v) => !v || isValidBankAccount(v), "validation.bankAccount"),
    ifsc: z.string().trim().toUpperCase().optional().transform((v) => v || null).refine((v) => !v || isValidIfsc(v), "validation.ifsc"),
    bankName: optText(100),
    enhanced: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
    normal: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
    enhancedUntil: isoDateField.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.dateOfDeath > todayIST()) ctx.addIssue({ code: "custom", path: ["dateOfDeath"], message: "validation.notFuture" });
    if (!v.nextPayee) return;
    if (!v.familyMemberId && !v.payeeName) ctx.addIssue({ code: "custom", path: ["familyMemberId"], message: "validation.required" });
    if (!v.familyMemberId && !v.relation) ctx.addIssue({ code: "custom", path: ["relation"], message: "validation.required" });
    if (!v.familyMemberId && !v.payeeDob) ctx.addIssue({ code: "custom", path: ["payeeDob"], message: "validation.required" });
    if (!v.bankAccount) ctx.addIssue({ code: "custom", path: ["bankAccount"], message: "validation.required" });
    if (v.bankAccount && !v.ifsc) ctx.addIssue({ code: "custom", path: ["ifsc"], message: "validation.required" });
  });

type NextPayee = { name: string; relation: string; dob: ISODate; mobile: string | null; bank: { enc: string; hash: string; last4: string; ifsc: string; name: string | null } };
type DeathPayload =
  | { kind: "PENSIONER"; pensionerId: string; dateOfDeath: ISODate; note: string; next: (NextPayee & { enhanced: number; normal: number; enhancedUntil: ISODate | null }) | null }
  | { kind: "EMPLOYEE"; employeeId: string; dateOfDeath: ISODate; note: string; next: NextPayee | null };

/**
 * Family pension after a pensioner's death, as the form suggests it: the figures from the approved case; for a pension
 * brought over from the old records, emoluments are taken as twice the basic pension (full pension is half of them).
 */
export async function familyPensionDefaults(actor: Actor, pensionerId: string, dateOfDeath?: string | null) {
  if (!canManagePension(actor)) throw forbidden();
  const p = await db.pensioner.findFirst({ where: { id: pensionerId, boardId: actor.boardId }, include: { employee: { include: { family: true } } } });
  if (!p) throw notFound();
  const death = dateOfDeath && /^\d{4}-\d{2}-\d{2}$/.test(dateOfDeath) ? (dateOfDeath as ISODate) : todayIST();
  const from = addDays(death, 1);
  let enhanced: number;
  let normal: number;
  let enhancedUntil: ISODate | null;
  if (p.type === "FAMILY") {
    // A family pension passing to the next member continues at the rate it had reached.
    const reducedNow = p.reducedFrom && toISODate(p.reducedFrom) <= from;
    enhanced = reducedNow ? num(p.reducedPension) : num(p.basicPension);
    normal = p.reducedPension !== null ? num(p.reducedPension) : enhanced;
    enhancedUntil = !reducedNow && p.reducedFrom ? addDays(toISODate(p.reducedFrom), -1) : null;
  } else {
    const c = p.caseId ? await db.pensionCase.findUnique({ where: { id: p.caseId } }) : null;
    const w = c ? (c.working as unknown as StoredWorking) : null;
    const rates = await db.payRate.findMany({ where: { boardId: actor.boardId, key: { in: ["PENSION_MIN", "FAMILY_PENSION_NORMAL", "FAMILY_PENSION_ENHANCED"] }, effectiveFrom: { lte: fromISODate(from) } }, orderBy: { effectiveFrom: "asc" } });
    const r: Record<string, number> = {};
    for (const x of rates) r[x.key] = num(x.value);
    const pay = num(p.basicPension) * 2;
    normal = w ? w.familyPension.normal : Math.max(r.PENSION_MIN ?? 0, Math.ceil((pay * (r.FAMILY_PENSION_NORMAL ?? 30)) / 100));
    enhanced = w ? w.familyPension.enhanced : Math.max(normal, Math.min(Math.ceil((pay * (r.FAMILY_PENSION_ENHANCED ?? 50)) / 100), num(p.basicPension)));
    // Enhanced for 7 years from the day after retirement, or until the pensioner would have been 67 — whichever is first.
    const seven = addDays(addYears(toISODate(p.startDate), 7), -1);
    const at67 = addDays(addYears(toISODate(p.employee.dateOfBirth), 67), -1);
    enhancedUntil = w ? w.familyPension.enhancedUntil : seven < at67 ? seven : at67;
    if (enhancedUntil < from) {
      enhanced = normal;
      enhancedUntil = null;
    }
  }
  const spouse = p.employee.family.find((m) => m.relation === "SPOUSE" && m.name.replace(/^(Smt\.|Shri)\s*/, "") !== p.payeeName);
  return { enhanced, normal, enhancedUntil, suggestedMemberId: p.relation === "SELF" ? (spouse?.id ?? null) : null, family: p.employee.family.map((m) => ({ id: m.id, name: m.name, relation: m.relation, dob: m.dateOfBirth ? toISODate(m.dateOfBirth) : null })) };
}

async function nextPayeeFrom(employeeId: string, input: z.infer<typeof deathSchema>): Promise<NextPayee | null> {
  if (!input.nextPayee) return null;
  let name = input.payeeName ?? "";
  let relation: string = input.relation ?? "OTHER";
  let dob = input.payeeDob ?? null;
  if (input.familyMemberId) {
    const m = await db.familyMember.findFirst({ where: { id: input.familyMemberId, employeeId } });
    if (!m) throw badRequest("errors.validation", { familyMemberId: "validation.invalid" });
    name = m.name;
    relation = (RELATIONS as readonly string[]).includes(m.relation) ? m.relation : "OTHER";
    dob = m.dateOfBirth ? toISODate(m.dateOfBirth) : input.payeeDob ?? null;
  }
  if (!dob) throw badRequest("errors.validation", { payeeDob: "validation.required" });
  const s = seal("bank", input.bankAccount!);
  return { name, relation, dob, mobile: input.mobile, bank: { enc: s.enc, hash: s.hash, last4: s.last4, ifsc: input.ifsc!, name: input.bankName } };
}

/** PN-11: the Pension clerk records a pensioner's death; a Checker approves. */
export async function proposePensionerDeath(actor: Actor, pensionerId: string, raw: unknown) {
  if (!canManagePension(actor)) throw forbidden();
  const input = deathSchema.parse(raw);
  const p = await db.pensioner.findFirst({ where: { id: pensionerId, boardId: actor.boardId } });
  if (!p) throw notFound();
  if (p.status !== "ACTIVE") throw conflict("pension.errors.pensionStopped");
  if (p.employeeId === actor.employeeId) throw forbidden("errors.ownPay");
  if (input.dateOfDeath < toISODate(p.startDate)) throw badRequest("errors.validation", { dateOfDeath: "pension.errors.deathBeforeStart" });
  const defaults = await familyPensionDefaults(actor, pensionerId, input.dateOfDeath);
  const payee = await nextPayeeFrom(p.employeeId, input);
  const next = payee ? { ...payee, enhanced: input.enhanced ?? defaults.enhanced, normal: input.normal ?? defaults.normal, enhancedUntil: input.enhancedUntil === undefined ? defaults.enhancedUntil : input.enhancedUntil } : null;
  const overpaid = (await pensionOverpaid(db, p.id, input.dateOfDeath)).total;
  const rows: NonNullable<ApprovalDetails["rows"]> = [
    { label: "Pensioner", labelHi: "पेंशनभोगी", new: `${p.payeeName} (PPO ${p.ppoNumber})` },
    { label: "Date of death", labelHi: "मृत्यु तिथि", new: formatDate(input.dateOfDeath) },
    { label: "Pension stops after", labelHi: "पेंशन कब तक", new: formatDate(input.dateOfDeath) },
    { label: "Paid after the death (to recover)", labelHi: "मृत्यु के बाद भुगतान (वसूली)", new: overpaid ? formatINR(overpaid) : "—" },
  ];
  if (next) {
    rows.push({ label: "Family pension to", labelHi: "पारिवारिक पेंशन किसे", new: `${next.name} (${next.relation}) from ${formatDate(addDays(input.dateOfDeath, 1))}` });
    rows.push({ label: "Family pension a month", labelHi: "मासिक पारिवारिक पेंशन", new: next.enhancedUntil && next.normal < next.enhanced ? `${formatINR(next.enhanced)} to ${formatDate(next.enhancedUntil)}, then ${formatINR(next.normal)}` : formatINR(next.enhanced) });
    rows.push({ label: "Bank account", labelHi: "बैंक खाता", new: `••••${next.bank.last4} · ${next.bank.ifsc}`, reveal: "bankAccount" });
  }
  const payload: DeathPayload = { kind: "PENSIONER", pensionerId: p.id, dateOfDeath: input.dateOfDeath, note: input.note, next };
  return db.$transaction(async (tx) => {
    if (await tx.approvalTask.count({ where: { boardId: actor.boardId, kind: "pension.death", entityId: p.id, status: "PENDING" } })) throw conflict("pension.errors.changeWaiting");
    return submitForApproval(tx, actor, {
      kind: "pension.death",
      title: `Death of pensioner ${p.payeeName} (PPO ${p.ppoNumber})`,
      titleHi: `पेंशनभोगी ${p.payeeNameHi ?? p.payeeName} का निधन (पीपीओ ${p.ppoNumber})`,
      details: { rows, summary: input.note, link: `/pension/pensioners/${p.id}` },
      payload: { ...payload, data: next ? { bankAccountEnc: next.bank.enc } : {} },
      subjectEmployeeId: p.employeeId,
      entityType: "Pensioner",
      entityId: p.id,
      note: input.note,
    });
  });
}

/** PN-11: an employee's death in service — pay stops; a family pension case is started for the Pension clerk. */
export async function proposeEmployeeDeath(actor: Actor, employeeId: string, raw: unknown) {
  if (!canManagePension(actor)) throw forbidden();
  const input = deathSchema.parse(raw);
  const e = await db.employee.findFirst({ where: { id: employeeId, boardId: actor.boardId } });
  if (!e) throw notFound();
  if (e.id === actor.employeeId) throw forbidden("errors.ownPay");
  if (!["ACTIVE", "SUSPENDED"].includes(e.status)) throw badRequest("errors.validation", { employeeId: "employees.errors.notCurrent" });
  if (input.dateOfDeath < toISODate(e.dateOfJoining)) throw badRequest("errors.validation", { dateOfDeath: "pension.errors.deathBeforeStart" });
  const next = await nextPayeeFrom(e.id, input);
  const rows: NonNullable<ApprovalDetails["rows"]> = [
    { label: "Employee", labelHi: "कर्मचारी", new: `${fullName(e)} (${e.employeeCode ?? "—"})` },
    { label: "Date of death", labelHi: "मृत्यु तिथि", new: formatDate(input.dateOfDeath) },
    { label: "Pay stops after", labelHi: "वेतन कब तक", new: formatDate(input.dateOfDeath) },
  ];
  if (next) {
    rows.push({ label: "Family pension and benefits to", labelHi: "पारिवारिक पेंशन और लाभ किसे", new: `${next.name} (${next.relation})` });
    rows.push({ label: "Bank account", labelHi: "बैंक खाता", new: `••••${next.bank.last4} · ${next.bank.ifsc}`, reveal: "bankAccount" });
  }
  const payload: DeathPayload = { kind: "EMPLOYEE", employeeId: e.id, dateOfDeath: input.dateOfDeath, note: input.note, next };
  return db.$transaction(async (tx) => {
    if (await tx.approvalTask.count({ where: { boardId: actor.boardId, kind: "pension.death", entityId: e.id, status: "PENDING" } })) throw conflict("pension.errors.changeWaiting");
    return submitForApproval(tx, actor, {
      kind: "pension.death",
      title: `Death in service — ${fullName(e)}`,
      titleHi: `सेवा में निधन — ${e.nameHi ?? fullName(e)}`,
      details: { rows, summary: input.note, link: `/employees/${e.id}` },
      payload: { ...payload, data: next ? { bankAccountEnc: next.bank.enc } : {} },
      subjectEmployeeId: e.id,
      entityType: "Employee",
      entityId: e.id,
      note: input.note,
    });
  });
}

/** Pension heads drawn for days after a death, from approved pension bills (due vs drawn, month by month and head). */
export async function pensionOverpaid(tx: DbLike, pensionerId: string, death: ISODate): Promise<{ total: number; byMonth: Record<string, Record<string, number>> }> {
  const p = await tx.pensioner.findUniqueOrThrow({ where: { id: pensionerId } });
  const from = death.slice(0, 7);
  const { drawn, paidMonths } = await drawnByMonth(tx, [p.id], from);
  const heads = await pensionHeads(tx, p.boardId);
  const kindOf = new Map(heads.map((h) => [h.code, h.kind]));
  const rateRows = await tx.payRate.findMany({ where: { boardId: p.boardId }, orderBy: { effectiveFrom: "asc" } });
  const facts = { ...factsOf(p), endDate: death };
  let paise = 0;
  const byMonth: Record<string, Record<string, number>> = {};
  for (const key of paidMonths) {
    const month = key.split("|")[1];
    if (month < from) continue;
    const rates: Record<string, number> = {};
    for (const r of rateRows) if (toISODate(r.effectiveFrom) <= `${month}-01`) rates[r.key] = num(r.value);
    const due = computePension({ facts, month, rates, heads });
    for (const code of COMPARED) {
      const sign = kindOf.get(code) === "DEDUCTION" ? -1 : 1;
      const d = due.lines.find((l) => l.code === code)?.amount ?? 0;
      const w = drawn.get(`${p.id}|${month}|${code}`) ?? 0;
      if (w === d) continue;
      (byMonth[month] ??= {})[code] = fromPaise(toPaise(w) - toPaise(d));
      paise += sign * (toPaise(w) - toPaise(d));
    }
  }
  return { total: Math.max(0, fromPaise(paise)), byMonth };
}

/** The first month whose regular pension bill is not yet approved — where a new recovery can start. */
async function firstOpenMonth(tx: DbLike, boardId: string) {
  let month = todayIST().slice(0, 7);
  while (await tx.payrollRun.count({ where: { boardId, payGroup: "PENSION", kind: "REGULAR", month, status: { in: [...PAID] } } })) month = shiftMonth(month, 1);
  return month;
}

async function newPpo(tx: Tx, boardId: string, base: string) {
  for (let i = 1; ; i++) {
    const ppo = `${base}/F${i > 1 ? i : ""}`;
    if (!(await tx.pensioner.findFirst({ where: { boardId, ppoNumber: ppo }, select: { id: true } }))) return ppo;
  }
}

export async function applyDeath(tx: Tx, task: ApprovalTask, actor: Actor, payload: DeathPayload) {
  const death = payload.dateOfDeath;
  const from = addDays(death, 1);
  if (payload.kind === "PENSIONER") {
    const p = await tx.pensioner.findUniqueOrThrow({ where: { id: payload.pensionerId } });
    if (p.status !== "ACTIVE") throw conflict("pension.errors.pensionStopped");
    const over = await pensionOverpaid(tx, p.id, death);
    const overpaid = over.total;
    await tx.pensioner.update({ where: { id: p.id }, data: { status: "STOPPED", endDate: fromISODate(death), endReason: `Died on ${formatDate(death)}`, endDetail: { overpaid: over.byMonth, total: overpaid } as unknown as Prisma.InputJsonValue } });
    await tx.user.updateMany({ where: { OR: [{ pensionerId: p.id }, ...(p.relation === "SELF" ? [{ employeeId: p.employeeId, loginType: "EMPLOYEE" as const }] : [])] }, data: { status: "DISABLED" } });
    if (p.relation === "SELF") await tx.employee.update({ where: { id: p.employeeId }, data: { status: "DECEASED" } });
    let next: { id: string; ppoNumber: string } | null = null;
    if (payload.next) {
      const n = payload.next;
      const reduce = n.enhancedUntil && n.normal < n.enhanced;
      next = await tx.pensioner.create({
        data: {
          boardId: p.boardId,
          employeeId: p.employeeId,
          ppoNumber: await newPpo(tx, p.boardId, p.ppoNumber),
          type: "FAMILY",
          relation: n.relation,
          payeeName: n.name,
          payeeDob: fromISODate(n.dob),
          mobile: n.mobile,
          basicPension: n.enhanced,
          reducedPension: reduce ? n.normal : null,
          reducedFrom: reduce ? fromISODate(addDays(n.enhancedUntil!, 1)) : null,
          fmaEligible: p.fmaEligible,
          startDate: fromISODate(from),
          bankAccountEnc: n.bank.enc,
          bankAccountHash: n.bank.hash,
          bankAccountLast4: n.bank.last4,
          ifsc: n.bank.ifsc,
          bankName: n.bank.name,
          previousId: p.id,
          caseId: p.caseId,
          createdById: task.makerId,
        },
        select: { id: true, ppoNumber: true },
      });
    }
    if (overpaid > 0) {
      // Recovered from the family pension in instalments of up to a third of it; with nobody to follow, it stays on record.
      const monthly = payload.next ? Math.max(1, Math.floor(payload.next.enhanced / 3)) : overpaid;
      const months = Math.ceil(overpaid / monthly);
      const start = await firstOpenMonth(tx, p.boardId);
      const instalment = Math.ceil(overpaid / months);
      const last = fromPaise(toPaise(overpaid) - toPaise(instalment) * (months - 1));
      const note = `Pension paid after the death of ${p.payeeName} on ${formatDate(death)} (PPO ${p.ppoNumber})`;
      if (months > 1) await tx.employeePayItem.create({ data: { boardId: p.boardId, employeeId: p.employeeId, headCode: "RECOVERY", amount: instalment, fromMonth: start, toMonth: shiftMonth(start, months - 2), note, createdById: task.makerId } });
      await tx.employeePayItem.create({ data: { boardId: p.boardId, employeeId: p.employeeId, headCode: "RECOVERY", amount: months > 1 ? last : overpaid, fromMonth: shiftMonth(start, months - 1), toMonth: shiftMonth(start, months - 1), note, createdById: task.makerId } });
    }
    await audit(tx, actor, { action: "APPROVE", entityType: "Pensioner", entityId: p.id, summary: `Death of pensioner ${p.payeeName} on ${formatDate(death)} recorded — pension stopped${next ? `, family pension ${next.ppoNumber} from ${formatDate(from)}` : ""}${overpaid ? `, ${formatINR(overpaid)} to recover` : ""}`, newValue: { taskId: task.id, overpaid, next: next?.ppoNumber ?? null }, sensitive: true });
    await emit(tx, p.boardId, "pension.death", { type: "Pensioner", id: p.id }, { dateOfDeath: death, familyPensionerId: next?.id ?? null, overpaid });
    return;
  }
  const e = await tx.employee.findUniqueOrThrow({ where: { id: payload.employeeId } });
  if (!["ACTIVE", "SUSPENDED"].includes(e.status)) throw conflict("employees.errors.notCurrent");
  await tx.employee.update({ where: { id: e.id }, data: { status: "DECEASED", exitDate: fromISODate(death), exitReason: "Died in service" } });
  await tx.user.updateMany({ where: { employeeId: e.id }, data: { status: "DISABLED" } });
  await tx.serviceBookEntry.create({ data: { employeeId: e.id, event: "OTHER", eventDate: fromISODate(death), details: `Died in service on ${formatDate(death)}. ${payload.note}`, detailsHi: `${formatDate(death, "hi")} को सेवा में निधन।`, status: "APPROVED", createdById: task.makerId } });
  let caseId: string | null = null;
  if (["PERMANENT_OPS", "PERMANENT_NPS"].includes(e.type) && !(await tx.pensionCase.findFirst({ where: { employeeId: e.id, status: { in: ["DRAFT", "CHECKING", "APPROVING", "APPROVED"] } } }))) {
    const n = payload.next;
    const member = n ? await tx.familyMember.findFirst({ where: { employeeId: e.id, name: n.name } }) : null;
    const inputs: CaseInputs = {
      lastDay: death,
      commutationPct: 0,
      nonQualifyingDays: null,
      familyMember: n ? { id: member?.id ?? "", name: n.name, relation: n.relation, dob: n.dob } : null,
      mobile: n?.mobile ?? null,
      bank: n?.bank ?? null,
      fmaEligible: true,
      note: payload.note,
    };
    const working = await workCase(tx, e.boardId, null, e.id, "FAMILY", inputs);
    const sections = await tx.section.findMany({ where: { boardId: e.boardId, isActive: true }, select: { id: true } });
    const c = await tx.pensionCase.create({
      data: { boardId: e.boardId, employeeId: e.id, type: "FAMILY", retirementDate: fromISODate(death), inputs: inputs as unknown as Prisma.InputJsonValue, working: working as unknown as Prisma.InputJsonValue, createdById: task.makerId, createdByName: task.makerName, noDues: { create: sections.map((s) => ({ sectionId: s.id })) } },
    });
    caseId = c.id;
  }
  await audit(tx, actor, { action: "APPROVE", entityType: "Employee", entityId: e.id, summary: `Death in service of ${fullName(e)} on ${formatDate(death)} recorded — off the rolls${caseId ? "; family pension case started" : ""}`, newValue: { taskId: task.id, caseId }, sensitive: true });
  await emit(tx, e.boardId, "employee.died", { type: "Employee", id: e.id }, { dateOfDeath: death, caseId });
}
