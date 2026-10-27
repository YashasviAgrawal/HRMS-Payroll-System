/**
 * PN-02, S-61: the month's pension bill worked out from the pensioner records — the pension paid through the same payroll
 * stages as salaries (pay group "Pensioners"). Pure reading, nothing saved; no "server-only" (the seed runs it too).
 *
 * - Every pension running in the month, by days when it starts or stops in the month.
 * - Months the pension was due but not yet paid by an approved pension bill here (a case approved late, a family pension
 *   that began after the month's bill went out, a pension held for want of a life certificate) are paid with the next
 *   slip, month by month at the rates now in force.
 * - A family pension starting mid-month after a death waits for the next bill, so the month's slip stays the deceased's.
 * - The life certificate (PN-06): a pension more than a month overdue is withheld by the system.
 * - TDS (ST-04) for the pensioner's own pension, projected on the year as for salaries; recoveries from pay items.
 */
import type { DbLike } from "@/lib/db";
import { datesOfMonth, endOfMonth, formatDate, fromISODate, shiftMonth, toISODate, type ISODate } from "@/lib/dates";
import { changePct, preChecks, type Found } from "@/modules/payroll/checks";
import type { ComputedSlip } from "@/modules/payroll/compute";
import type { PayLine } from "@/modules/payroll/engine";
import { headFlags, monthsStillToCome, partsOf, projectTds, taxContext, type TaxDetail } from "@/modules/statutory/tds-projection";
import { computePension, lifeCertificateHoldFrom, lifeCertificateValidTill, sumLines, type PensionFacts, type PensionHead } from "./rules";

const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;
/** Heads a pension bill uses; standing pay items for anything else (a former salary item) are not carried into pension. */
export const PENSION_HEADS = ["BASIC_PENSION", "ADDL_PENSION", "DR", "FMA", "COMMUTATION", "IT", "RECOVERY", "COURT"];
const ITEM_HEADS = ["RECOVERY", "COURT"];

/** An earlier month paid with a later slip; its lines are kept so arrears can tell what each month drew. */
export interface CatchUpMonth {
  month: string;
  net: number;
  lines: PayLine[];
}

export function factsOf(p: { type: string; basicPension: unknown; reducedPension: unknown; reducedFrom: Date | null; commutedAmount: unknown; commutationDate: Date | null; payeeDob: Date; fmaEligible: boolean; startDate: Date; endDate: Date | null }): PensionFacts {
  return {
    type: p.type,
    basicPension: num(p.basicPension as never),
    reducedPension: p.reducedPension === null || p.reducedPension === undefined ? null : num(p.reducedPension as never),
    reducedFrom: p.reducedFrom ? toISODate(p.reducedFrom) : null,
    commutedAmount: num(p.commutedAmount as never),
    commutationDate: p.commutationDate ? toISODate(p.commutationDate) : null,
    payeeDob: toISODate(p.payeeDob),
    fmaEligible: p.fmaEligible,
    startDate: toISODate(p.startDate),
    endDate: p.endDate ? toISODate(p.endDate) : null,
  };
}

/** Rates in force on each month's 1st, read once for all the months a bill touches. */
async function ratesByMonth(tx: DbLike, boardId: string) {
  const rows = await tx.payRate.findMany({ where: { boardId }, orderBy: { effectiveFrom: "asc" } });
  const cache = new Map<string, Record<string, number>>();
  return (month: string) => {
    if (!cache.has(month)) {
      const first = `${month}-01`;
      const out: Record<string, number> = {};
      for (const r of rows) if (toISODate(r.effectiveFrom) <= first) out[r.key] = num(r.value);
      cache.set(month, out);
    }
    return cache.get(month)!;
  };
}

export async function pensionHeads(tx: DbLike, boardId: string): Promise<PensionHead[]> {
  const rows = await tx.payHead.findMany({ where: { boardId, code: { in: PENSION_HEADS }, isActive: true }, orderBy: [{ sortOrder: "asc" }] });
  return rows.map((h) => ({ code: h.code, name: h.name, nameHi: h.nameHi, kind: h.kind, accountHead: h.accountHead }));
}

/**
 * Family pensions are paid on the record of the person whose service earned them, but they are the family member's
 * income, not that person's salary: tax workings and returns leave them out.
 */
export async function familyPensionIds(tx: DbLike, boardId: string): Promise<Set<string>> {
  return new Set((await tx.pensioner.findMany({ where: { boardId, relation: { not: "SELF" } }, select: { id: true } })).map((p) => p.id));
}

/** The month the Board first paid pensions through this system: earlier months were paid by the old system. */
async function firstPensionMonth(tx: DbLike, boardId: string): Promise<string | null> {
  const first = await tx.payrollRun.findFirst({ where: { boardId, payGroup: "PENSION", kind: "REGULAR", status: { in: [...PAID] } }, orderBy: { month: "asc" }, select: { month: true } });
  return first?.month ?? null;
}

export async function computePensionRun(tx: DbLike, boardId: string, month: string) {
  const monthStart: ISODate = `${month}-01`;
  const monthEnd = endOfMonth(monthStart);
  const dim = datesOfMonth(month).length;
  const last = shiftMonth(month, -1);
  const [pensioners, rateFor, heads, allHeads, firstMonth] = await Promise.all([
    tx.pensioner.findMany({
      where: { boardId, startDate: { lte: fromISODate(monthEnd) }, OR: [{ endDate: null }, { endDate: { gte: fromISODate(monthStart) } }] },
      include: {
        employee: { select: { id: true, sectionId: true, postId: true } },
        lifeCertificates: { where: { status: "VERIFIED" }, orderBy: { certifiedOn: "desc" }, take: 1, select: { certifiedOn: true } },
      },
      orderBy: { ppoNumber: "asc" },
    }),
    ratesByMonth(tx, boardId),
    pensionHeads(tx, boardId),
    tx.payHead.findMany({ where: { boardId } }),
    firstPensionMonth(tx, boardId),
  ]);
  const ids = pensioners.map((p) => p.id);
  const employeeIds = [...new Set(pensioners.map((p) => p.employeeId))];
  const [items, lastSlips, handled] = await Promise.all([
    tx.employeePayItem.findMany({ where: { boardId, employeeId: { in: employeeIds }, headCode: { in: ITEM_HEADS }, fromMonth: { lte: month }, OR: [{ toMonth: null }, { toMonth: { gte: month } }] } }),
    tx.payslip.findMany({ where: { pensionerId: { in: ids }, month: last, status: "INCLUDED", run: { payGroup: "PENSION", status: { in: [...PAID] } } }, select: { pensionerId: true, net: true } }),
    // Months already paid by an approved pension bill, on their own slip or with a later one.
    tx.payslip.findMany({ where: { pensionerId: { in: ids }, month: { lt: month }, status: "INCLUDED", run: { payGroup: "PENSION", kind: "REGULAR", status: { in: [...PAID] } } }, select: { pensionerId: true, month: true, detail: true } }),
  ]);
  const flags = headFlags(allHeads);
  const self = pensioners.filter((p) => p.relation === "SELF").map((p) => p.employeeId);
  const taxCtx = await taxContext(tx, boardId, self, month, flags);
  const itemsBy = new Map<string, Record<string, number>>();
  for (const it of items) {
    const m = itemsBy.get(it.employeeId) ?? {};
    m[it.headCode] = (m[it.headCode] ?? 0) + num(it.amount);
    itemsBy.set(it.employeeId, m);
  }
  const lastNet = new Map(lastSlips.map((s) => [s.pensionerId!, num(s.net)]));
  const done = new Set(handled.flatMap((h) => [h.month, ...(((h.detail ?? {}) as { catchUp?: CatchUpMonth[] }).catchUp ?? []).map((c) => c.month)].map((m) => `${h.pensionerId}|${m}`)));
  const holders = new Map<string, number>();
  for (const p of pensioners) if (p.bankAccountHash && p.status === "ACTIVE") holders.set(p.bankAccountHash, (holders.get(p.bankAccountHash) ?? 0) + 1);

  const slips: ComputedSlip[] = [];
  const facts: Parameters<typeof preChecks>[0] = [];
  const found: Found[] = [];
  const seen = new Set<string>();
  for (const p of pensioners) {
    const f = factsOf(p);
    // A family pension beginning mid-month after a death is paid from the next bill (the month's slip is the deceased's).
    if (p.previousId && f.startDate > monthStart && f.startDate <= monthEnd) continue;
    if (seen.has(p.employeeId)) continue;
    seen.add(p.employeeId);
    const personItems = { ...(itemsBy.get(p.employeeId) ?? {}) };
    const current = computePension({ facts: f, month, rates: rateFor(month), heads, items: personItems });
    // Earlier months due here and not yet paid by an approved pension bill.
    const catchUp: CatchUpMonth[] = [];
    const parts = [current.lines];
    const from = f.startDate.slice(0, 7);
    if (firstMonth) {
      for (let m = from > firstMonth ? from : firstMonth; m < month; m = shiftMonth(m, 1)) {
        if (done.has(`${p.id}|${m}`)) continue;
        const back = computePension({ facts: f, month: m, rates: rateFor(m), heads });
        if (!back.lines.length) continue;
        catchUp.push({ month: m, net: back.net, lines: back.lines });
        parts.push(back.lines);
      }
    }
    let lines = catchUp.length ? sumLines(parts) : current.lines;
    let tax: TaxDetail | undefined;
    if (p.relation === "SELF") {
      const monthly = computePension({ facts: { ...f, startDate: f.startDate < monthStart ? f.startDate : monthStart }, month, rates: rateFor(month), heads });
      tax = projectTds(taxCtx, p.employeeId, partsOf(lines, flags), partsOf(monthly.lines, flags), monthsStillToCome(month, taxCtx.fy, f.endDate));
      if (tax.monthly > 0) {
        const withTax = computePension({ facts: f, month, rates: rateFor(month), heads, items: { ...personItems, IT: tax.monthly } });
        lines = catchUp.length ? sumLines([withTax.lines, ...parts.slice(1)]) : withTax.lines;
      }
    }
    const gross = lines.filter((l) => l.kind === "EARNING").reduce((s, l) => s + l.amount, 0);
    const deductions = lines.filter((l) => l.kind === "DEDUCTION").reduce((s, l) => s + l.amount, 0);
    const net = Math.round((gross - deductions) * 100) / 100;
    if (!lines.length) continue;
    const prevNet = lastNet.get(p.id) ?? null;
    slips.push({
      employeeId: p.employeeId,
      pensionerId: p.id,
      sectionId: p.employee.sectionId,
      postId: p.employee.postId,
      payLevel: null,
      payCell: null,
      daysInMonth: dim,
      daysOnRoll: current.days,
      lossDays: 0,
      halfPayDays: 0,
      workedDays: null,
      lines,
      gross,
      deductions,
      net,
      employer: 0,
      bankLast4: p.bankAccountLast4,
      ifsc: p.ifsc,
      lastNet: prevNet,
      changePct: changePct(net, prevNet),
      detail: { pension: { ppoNumber: p.ppoNumber, type: p.type, relation: p.relation, payee: p.payeeName, payeeHi: p.payeeNameHi }, ...(catchUp.length ? { catchUp } : {}), ...(tax ? { tax } : {}) },
    });
    facts.push({ employeeId: p.employeeId, net, lastNet: catchUp.length ? null : prevNet, hasBank: Boolean(p.bankAccountHash && p.ifsc), bankHash: p.bankAccountHash, afterRetirement: false, noPayLevel: false, suspended: false });
    // PN-06: held once the life certificate is more than a month overdue.
    const validTill = lifeCertificateValidTill(p.lifeCertificates[0] ? toISODate(p.lifeCertificates[0].certifiedOn) : f.startDate);
    const holdFrom = lifeCertificateHoldFrom(validTill);
    if (monthEnd >= holdFrom) {
      found.push({ employeeId: p.employeeId, code: "LIFE_CERTIFICATE", vars: { validTill, ppo: p.ppoNumber }, resolved: { resolution: "WITHHELD", note: `Life certificate due by ${formatDate(validTill)} not received` } });
    }
  }
  return { slips, found: [...preChecks(facts, holders), ...found], rates: rateFor(month), matrixName: null };
}
