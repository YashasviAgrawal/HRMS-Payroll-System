import "server-only";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db, type DbLike } from "@/lib/db";
import { datesOfMonth, isMonth, shiftMonth, todayIST } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { formatINR, fromPaise, toPaise } from "@/lib/money";
import { emit } from "@/lib/outbox";
import type { ArrearLine, ArrearMonth } from "@/modules/payroll/arrears";
import { preChecks, type Found } from "@/modules/payroll/checks";
import { saveRun, titleOf, type ComputedSlip, type SupplementarySource } from "@/modules/payroll/compute";
import type { PayLine } from "@/modules/payroll/engine";
import type { CaseInputs, StoredWorking } from "./cases";
import { factsOf, pensionHeads, type CatchUpMonth } from "./compute";
import { computePension } from "./rules";

/**
 * Pension bills other than the month's, as supplementary bills of the pay group "Pensioners" through the same five
 * stages (S-61):
 *
 * - PN-05 arrears: when dearness relief (or any pension rate) is raised from an earlier date, every pensioner's due for
 *   the months already paid is worked out again and the difference paid — due vs drawn, as for salaries. Arrears of a
 *   pensioner who has since died are paid to the family pensioner who follows.
 * - PN-09 retirement benefits: gratuity, the commuted value of pension and leave encashment from an approved pension
 *   case, paid once into the pensioner's (or the family pensioner's) account.
 */
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;
/** Heads worked out from the pension record; recoveries and TDS follow their own registers. */
export const COMPARED = new Set(["BASIC_PENSION", "ADDL_PENSION", "DR", "FMA", "COMMUTATION"]);
const BENEFIT_HEADS = ["GRATUITY", "COMMUTED_VALUE", "LEAVE_ENCASHMENT"] as const;

const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const canMake = (actor: Actor) => canAll(actor, "pension", "create");

type Source = SupplementarySource & { payGroup: "PENSION" };

export interface PensionerArrears {
  pensionerId: string;
  employeeId: string;
  months: ArrearMonth[];
  gross: number;
  deductions: number;
  net: number;
}

const add = (m: Map<string, number>, key: string, amount: number) => m.set(key, fromPaise(toPaise(m.get(key) ?? 0) + toPaise(amount)));

/**
 * What each pensioner drew for each month from approved pension bills: the month's own slip (less the earlier months
 * paid with it), earlier months paid with a later slip, and arrears already paid for the month.
 */
export async function drawnByMonth(tx: DbLike, pensionerIds: string[], fromMonth: string) {
  const slips = await tx.payslip.findMany({
    where: { pensionerId: { in: pensionerIds }, status: "INCLUDED", run: { payGroup: "PENSION", status: { in: [...PAID] } }, month: { gte: fromMonth } },
    select: { pensionerId: true, month: true, lines: true, detail: true, run: { select: { kind: true } } },
  });
  const drawn = new Map<string, number>();
  const paidMonths = new Set<string>();
  for (const s of slips) {
    const p = s.pensionerId!;
    const detail = (s.detail ?? {}) as { catchUp?: CatchUpMonth[]; arrears?: ArrearMonth[] };
    if (s.run.kind === "REGULAR") {
      const own = new Map<string, number>();
      for (const l of s.lines as unknown as PayLine[]) add(own, l.code, l.amount);
      for (const c of detail.catchUp ?? []) {
        paidMonths.add(`${p}|${c.month}`);
        for (const l of c.lines) {
          add(drawn, `${p}|${c.month}|${l.code}`, l.amount);
          add(own, l.code, -l.amount);
        }
      }
      paidMonths.add(`${p}|${s.month}`);
      for (const [code, amount] of own) add(drawn, `${p}|${s.month}|${code}`, amount);
    } else {
      for (const m of detail.arrears ?? []) for (const l of m.lines) add(drawn, `${p}|${m.month}|${l.code}`, l.diff);
    }
  }
  return { drawn, paidMonths };
}

/** PN-05: due vs drawn for every pensioner and every month in the range that a pension bill here has paid. */
export async function computePensionArrears(tx: DbLike, boardId: string, fromMonth: string, toMonth: string, pensionerIds?: string[]): Promise<PensionerArrears[]> {
  const pensioners = await tx.pensioner.findMany({
    where: { boardId, ...(pensionerIds ? { id: { in: pensionerIds } } : {}), startDate: { lte: new Date(`${toMonth}-${datesOfMonth(toMonth).length}T00:00:00Z`) } },
    orderBy: { ppoNumber: "asc" },
  });
  if (!pensioners.length) return [];
  const [heads, rateRows, { drawn, paidMonths }] = await Promise.all([pensionHeads(tx, boardId), tx.payRate.findMany({ where: { boardId }, orderBy: { effectiveFrom: "asc" } }), drawnByMonth(tx, pensioners.map((p) => p.id), fromMonth)]);
  const headBy = new Map(heads.map((h) => [h.code, h]));
  const rateCache = new Map<string, Record<string, number>>();
  const rateFor = (month: string) => {
    if (!rateCache.has(month)) {
      const out: Record<string, number> = {};
      for (const r of rateRows) if (r.effectiveFrom.toISOString().slice(0, 10) <= `${month}-01`) out[r.key] = num(r.value);
      rateCache.set(month, out);
    }
    return rateCache.get(month)!;
  };
  const out: PensionerArrears[] = [];
  for (const p of pensioners) {
    const facts = factsOf(p);
    const person: PensionerArrears = { pensionerId: p.id, employeeId: p.employeeId, months: [], gross: 0, deductions: 0, net: 0 };
    // Pension paid for days after a death is already being recovered: only what was due counts as drawn.
    const recovering = ((p.endDetail ?? {}) as { overpaid?: Record<string, Record<string, number>> }).overpaid ?? {};
    for (let m = fromMonth; m <= toMonth; m = shiftMonth(m, 1)) {
      if (!paidMonths.has(`${p.id}|${m}`)) continue;
      const due = computePension({ facts, month: m, rates: rateFor(m), heads });
      const codes = new Set([...due.lines.map((l) => l.code), ...COMPARED].filter((c) => COMPARED.has(c)));
      const lines: ArrearLine[] = [];
      for (const code of codes) {
        const d = due.lines.find((l) => l.code === code)?.amount ?? 0;
        const w = fromPaise(toPaise(drawn.get(`${p.id}|${m}|${code}`) ?? 0) - toPaise(recovering[m]?.[code] ?? 0));
        if (d === w) continue;
        const h = headBy.get(code);
        if (!h) continue;
        lines.push({ code, name: h.name, nameHi: h.nameHi, kind: h.kind, accountHead: h.accountHead, due: d, drawn: w, diff: fromPaise(toPaise(d) - toPaise(w)) });
      }
      if (!lines.length) continue;
      person.months.push({ month: m, lines });
      for (const l of lines) {
        if (l.kind === "EARNING") person.gross = fromPaise(toPaise(person.gross) + toPaise(l.diff));
        else if (l.kind === "DEDUCTION") person.deductions = fromPaise(toPaise(person.deductions) + toPaise(l.diff));
      }
      person.net = fromPaise(toPaise(person.gross) - toPaise(person.deductions));
    }
    if (person.months.length) out.push(person);
  }
  return out;
}

export const pensionArrearsSchema = z.object({
  fromMonth: z.string().refine(isMonth, "validation.invalid"),
  toMonth: z.string().refine(isMonth, "validation.invalid"),
  reason: z.string().trim().min(3, "validation.tooShort").max(200),
});

/** S-61: who gets pension arrears for a period, before the bill is made. */
export async function previewPensionArrears(actor: Actor, raw: unknown) {
  if (!canAll(actor, "pension", "view")) throw forbidden();
  const input = pensionArrearsSchema.parse({ ...(raw as object), reason: (raw as { reason?: string })?.reason || "preview" });
  if (input.toMonth < input.fromMonth) throw badRequest("errors.validation", { toMonth: "payroll.errors.toBeforeFrom" });
  if (input.toMonth > todayIST().slice(0, 7)) throw badRequest("errors.validation", { toMonth: "payroll.errors.futureMonth" });
  const arrears = await computePensionArrears(db, actor.boardId, input.fromMonth, input.toMonth);
  const people = new Map((await db.pensioner.findMany({ where: { id: { in: arrears.map((a) => a.pensionerId) } }, select: { id: true, ppoNumber: true, payeeName: true, payeeNameHi: true, relation: true } })).map((p) => [p.id, p]));
  return arrears.map((a) => ({ ...a, ppoNumber: people.get(a.pensionerId)!.ppoNumber, name: people.get(a.pensionerId)!.payeeName, nameHi: people.get(a.pensionerId)!.payeeNameHi }));
}

/** The pensioner a payment for this person's pension goes to now: the latest pension that is still running. */
async function payeeFor(tx: DbLike, employeeId: string) {
  return tx.pensioner.findFirst({ where: { employeeId, status: "ACTIVE" }, orderBy: { startDate: "desc" } });
}

async function holdersOf(tx: DbLike, boardId: string) {
  const out = new Map<string, number>();
  for (const p of await tx.pensioner.findMany({ where: { boardId, status: "ACTIVE", bankAccountHash: { not: null } }, select: { bankAccountHash: true } })) out.set(p.bankAccountHash!, (out.get(p.bankAccountHash!) ?? 0) + 1);
  return out;
}

/** The slips of a pension arrears or benefits bill, from its source. */
async function buildPensionBill(tx: DbLike, boardId: string, src: Source, month: string): Promise<{ slips: ComputedSlip[]; found: Found[] }> {
  const dim = datesOfMonth(month).length;
  const slips: ComputedSlip[] = [];
  const facts: Parameters<typeof preChecks>[0] = [];
  const blank = { daysInMonth: dim, daysOnRoll: 0, lossDays: 0, halfPayDays: 0, workedDays: null, payLevel: null, payCell: null, employer: 0, lastNet: null, changePct: null };
  if (src.type === "ARREARS") {
    const arrears = await computePensionArrears(tx, boardId, src.fromMonth, src.toMonth, src.pensionerIds);
    // One slip a person whose service earned the pension, paid to whoever draws that pension now.
    const byEmployee = new Map<string, PensionerArrears[]>();
    for (const a of arrears) byEmployee.set(a.employeeId, [...(byEmployee.get(a.employeeId) ?? []), a]);
    for (const [employeeId, list] of byEmployee) {
      const payee = (await payeeFor(tx, employeeId)) ?? (await tx.pensioner.findUniqueOrThrow({ where: { id: list[list.length - 1].pensionerId } }));
      const e = await tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { sectionId: true, postId: true } });
      const totals = new Map<string, PayLine>();
      for (const a of list) {
        for (const m of a.months) {
          for (const l of m.lines) {
            const t = totals.get(l.code) ?? { code: l.code, name: l.name, nameHi: l.nameHi, kind: l.kind, amount: 0, accountHead: l.accountHead };
            t.amount = fromPaise(toPaise(t.amount) + toPaise(l.diff));
            totals.set(l.code, t);
          }
        }
      }
      const lines = [...totals.values()].filter((l) => l.amount !== 0);
      const gross = lines.filter((l) => l.kind === "EARNING").reduce((s, l) => fromPaise(toPaise(s) + toPaise(l.amount)), 0);
      const deductions = lines.filter((l) => l.kind === "DEDUCTION").reduce((s, l) => fromPaise(toPaise(s) + toPaise(l.amount)), 0);
      const net = fromPaise(toPaise(gross) - toPaise(deductions));
      slips.push({
        ...blank,
        employeeId,
        pensionerId: payee.id,
        sectionId: e.sectionId,
        postId: e.postId,
        lines,
        gross,
        deductions,
        net,
        bankLast4: payee.bankAccountLast4,
        ifsc: payee.ifsc,
        // Arrears months are kept by the pension they belong to, so a later bill knows what each one drew.
        detail: { pension: { ppoNumber: payee.ppoNumber, type: payee.type, relation: payee.relation, payee: payee.payeeName, payeeHi: payee.payeeNameHi }, arrears: list.flatMap((a) => a.months), arrearsOf: list.map((a) => ({ pensionerId: a.pensionerId, months: a.months.map((m) => m.month) })) },
      });
      facts.push({ employeeId, net, lastNet: null, hasBank: Boolean(payee.bankAccountHash && payee.ifsc), bankHash: payee.bankAccountHash, afterRetirement: false, noPayLevel: false, suspended: false });
    }
  } else if (src.type === "BENEFITS") {
    const c = await tx.pensionCase.findFirst({ where: { id: src.caseId, boardId }, include: { employee: { select: { id: true, sectionId: true, postId: true, bankAccountHash: true, bankAccountLast4: true, ifsc: true } } } });
    if (!c) throw notFound();
    const w = c.working as unknown as StoredWorking;
    const inputs = c.inputs as unknown as CaseInputs;
    const amounts: Record<(typeof BENEFIT_HEADS)[number], number> = { GRATUITY: w.gratuity?.amount ?? 0, COMMUTED_VALUE: w.commutation?.lumpSum ?? 0, LEAVE_ENCASHMENT: w.leaveEncashment?.amount ?? 0 };
    const heads = new Map((await tx.payHead.findMany({ where: { boardId, code: { in: [...BENEFIT_HEADS, "RECOVERY"] } } })).map((h) => [h.code, h]));
    const lines: PayLine[] = BENEFIT_HEADS.filter((code) => amounts[code] > 0 && heads.has(code)).map((code) => {
      const h = heads.get(code)!;
      return { code, name: h.name, nameHi: h.nameHi, kind: h.kind, amount: amounts[code], accountHead: h.accountHead };
    });
    const gross = lines.reduce((s, l) => fromPaise(toPaise(s) + toPaise(l.amount)), 0);
    // Dues from the no-dues checklist and pay drawn after a death come off the benefits (never more than them).
    const dues = Math.min(w.dues?.total ?? 0, gross);
    const recovery = heads.get("RECOVERY");
    if (dues > 0 && recovery) lines.push({ code: "RECOVERY", name: recovery.name, nameHi: recovery.nameHi, kind: recovery.kind, amount: dues, accountHead: recovery.accountHead });
    const payee = c.pensionerId ? await tx.pensioner.findUnique({ where: { id: c.pensionerId } }) : null;
    // With no pension to pay (NPS staff), a death's benefits go to the family member's account given on the case.
    const payTo = !payee && c.type === "FAMILY" && inputs.bank && inputs.familyMember ? { name: inputs.familyMember.name, enc: inputs.bank.enc, hash: inputs.bank.hash, last4: inputs.bank.last4, ifsc: inputs.bank.ifsc } : null;
    const bankHash = payee ? payee.bankAccountHash : payTo ? payTo.hash : c.employee.bankAccountHash;
    const ifsc = payee ? payee.ifsc : payTo ? payTo.ifsc : c.employee.ifsc;
    const net = fromPaise(toPaise(gross) - toPaise(dues > 0 && recovery ? dues : 0));
    if (lines.length) {
      slips.push({
        ...blank,
        employeeId: c.employeeId,
        ...(payee ? { pensionerId: payee.id } : {}),
        sectionId: c.employee.sectionId,
        postId: c.employee.postId,
        lines,
        gross,
        deductions: fromPaise(toPaise(gross) - toPaise(net)),
        net,
        bankLast4: payee ? payee.bankAccountLast4 : payTo ? payTo.last4 : c.employee.bankAccountLast4,
        ifsc,
        detail: {
          benefits: { caseId: c.id, dues: w.dues ?? null },
          ...(payee ? { pension: { ppoNumber: payee.ppoNumber, type: payee.type, relation: payee.relation, payee: payee.payeeName, payeeHi: payee.payeeNameHi } } : {}),
          ...(payTo ? { payTo: { name: payTo.name, accountEnc: payTo.enc, ifsc: payTo.ifsc } } : {}),
        },
      });
      facts.push({ employeeId: c.employeeId, net, lastNet: null, hasBank: Boolean(bankHash && ifsc), bankHash, afterRetirement: false, noPayLevel: false, suspended: false });
    }
  } else {
    throw new Error(`A pension bill cannot pay ${src.type}`);
  }
  return { slips, found: preChecks(facts, await holdersOf(tx, boardId)) };
}

async function savePensionBill(actor: Actor, src: Source, month: string, title: string, runId?: string) {
  const computed = await buildPensionBill(db, actor.boardId, src, month);
  if (!computed.slips.length) throw badRequest("payroll.supplementary.nothing");
  return db.$transaction(async (tx) => {
    const run = await saveRun(tx, actor, "PENSION", month, computed, { kind: "SUPPLEMENTARY", runId, source: src, title });
    const saved = await tx.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
    if (src.type === "BENEFITS") await tx.pensionCase.update({ where: { id: src.caseId }, data: { benefitsRunId: run.id } });
    await audit(tx, actor, { action: "RUN", entityType: "PayrollRun", entityId: run.id, summary: `${runId ? "Worked out again" : "Made"} ${titleOf(saved)}: ${computed.slips.length} pensioners, net ${formatINR(num(saved.net))}`, sensitive: true });
    await emit(tx, actor.boardId, "pension.bill", { type: "PayrollRun", id: run.id }, { source: src.type });
    return saved;
  });
}

/** PN-05, S-61: a pension arrears bill for every pensioner due arrears for the period. */
export async function makePensionArrearsBill(actor: Actor, raw: unknown) {
  if (!canMake(actor)) throw forbidden();
  const input = pensionArrearsSchema.parse(raw);
  if (input.toMonth < input.fromMonth) throw badRequest("errors.validation", { toMonth: "payroll.errors.toBeforeFrom" });
  if (input.toMonth > todayIST().slice(0, 7)) throw badRequest("errors.validation", { toMonth: "payroll.errors.futureMonth" });
  const arrears = await computePensionArrears(db, actor.boardId, input.fromMonth, input.toMonth);
  if (!arrears.length) throw badRequest("payroll.supplementary.nothing");
  const src: Source = { type: "ARREARS", payGroup: "PENSION", employeeIds: [], pensionerIds: arrears.map((a) => a.pensionerId), fromMonth: input.fromMonth, toMonth: input.toMonth, reason: input.reason };
  return savePensionBill(actor, src, todayIST().slice(0, 7), input.reason);
}

/** PN-09: the retirement benefits bill of an approved pension case — once (a bill sent back is corrected and worked out again). */
export async function makeBenefitsBill(actor: Actor, caseId: string) {
  if (!canMake(actor)) throw forbidden();
  const c = await db.pensionCase.findFirst({ where: { id: caseId, boardId: actor.boardId }, include: { employee: { select: { firstName: true, middleName: true, lastName: true } } } });
  if (!c) throw notFound();
  if (c.status !== "APPROVED") throw conflict("pension.errors.caseNotApproved");
  if (c.employeeId === actor.employeeId) throw forbidden("errors.ownPay");
  if (c.benefitsRunId && (await db.payrollRun.count({ where: { id: c.benefitsRunId } }))) throw conflict("pension.errors.benefitsBillExists");
  const name = [c.employee.firstName, c.employee.middleName, c.employee.lastName].filter(Boolean).join(" ");
  const src: Source = { type: "BENEFITS", payGroup: "PENSION", caseId: c.id, name };
  return savePensionBill(actor, src, todayIST().slice(0, 7), `Retirement benefits — ${name}`);
}

/** "Work out again" for a pension arrears or benefits bill still in draft. */
export async function rerunPensionBill(actor: Actor, runId: string) {
  if (!canMake(actor)) throw forbidden();
  const run = await db.payrollRun.findFirst({ where: { id: runId, boardId: actor.boardId, payGroup: "PENSION", kind: "SUPPLEMENTARY" } });
  if (!run) throw notFound();
  if (run.status !== "DRAFT") throw conflict("payroll.errors.notDraft");
  const src = { ...(run.source as unknown as SupplementarySource), payGroup: "PENSION" } as Source;
  return savePensionBill(actor, src, run.month, run.title ?? "", run.id);
}
