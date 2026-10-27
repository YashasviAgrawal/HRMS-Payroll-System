import "server-only";
import { z } from "zod";
import type { PayGroup } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db, type DbLike } from "@/lib/db";
import { datesOfMonth, fromISODate, isMonth, shiftMonth, todayIST } from "@/lib/dates";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { formatINR, fromPaise, toPaise } from "@/lib/money";
import { emit } from "@/lib/outbox";
import { fullName } from "@/modules/employees/present";
import { rerunPensionBill } from "@/modules/pension/bills";
import type { GpfRefund } from "@/modules/statutory/gpf-posting";
import { preChecks, type Found } from "./checks";
import {
  basicFrom,
  computeRun,
  matrixOn,
  payHeads,
  ratesOn,
  RUN_GROUPS,
  saveRun,
  titleOf,
  toHeadRule,
  type ComputedSlip,
  type LoanDue,
  type RunGroup,
  type StaffGroup,
  type SupplementarySource,
} from "./compute";
import { computePay, TYPES_IN_GROUP, WORKED_OUT, type PayLine } from "./engine";

/**
 * PR-08, S-42: arrears as "due vs drawn", and supplementary bills.
 *
 * Due: what a month should have paid with the rates, matrix and pay history as they stand now (a DA order dated back,
 * a late increment, a promotion), on the days the month actually paid. Drawn: what the approved pay bills of that month
 * paid, including arrears already paid for it. Only heads the system works out are compared — standing amounts (GPF
 * subscription, licence fee, TDS) and group insurance are not changed by a back-dated order.
 *
 * A supplementary bill is a payroll of its own (the same five stages) for arrears, for pay withheld at a pre-check and
 * since put right, or for joiners the month's regular bill missed.
 */
const PAID_STATUSES = ["APPROVED", "PAID", "CLOSED"] as const;
const COMPARED_CALCS = new Set(["SYSTEM", "FIXED", "PERCENT_BASIC"]);
// Worked-out deductions (loans, GPF advance recovery, TDS, professional tax) follow their own registers, not the order.
const NOT_COMPARED = new Set(["GPF", "GIS", ...WORKED_OUT]);

const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const canMake = (actor: Actor) => canAll(actor, "arrears_loans", "create");
const canSee = (actor: Actor) => canAll(actor, "arrears_loans", "view") || canAll(actor, "payroll", "view");

export interface ArrearLine {
  code: string;
  name: string;
  nameHi: string;
  kind: PayLine["kind"];
  accountHead: string;
  due: number;
  drawn: number;
  diff: number;
}

export interface ArrearMonth {
  month: string;
  lines: ArrearLine[];
}

export interface PersonArrears {
  employeeId: string;
  months: ArrearMonth[];
  gross: number;
  deductions: number;
  employer: number;
  net: number;
}

/** Due vs drawn for each person and month in the range. Months with no approved pay bill are skipped. */
export async function computeArrears(tx: DbLike, boardId: string, employeeIds: string[], fromMonth: string, toMonth: string): Promise<PersonArrears[]> {
  const slips = await tx.payslip.findMany({
    where: { boardId, employeeId: { in: employeeIds }, pensionerId: null, month: { gte: fromMonth, lte: toMonth }, status: "INCLUDED", run: { status: { in: [...PAID_STATUSES] } } },
    include: { run: { select: { kind: true } }, employee: { include: { post: true } } },
    orderBy: { month: "asc" },
  });
  // Arrears already paid for a month (by an earlier supplementary bill) count as drawn.
  const earlier = await tx.payslip.findMany({
    where: { boardId, employeeId: { in: employeeIds }, pensionerId: null, status: "INCLUDED", run: { kind: "SUPPLEMENTARY", status: { in: [...PAID_STATUSES] } } },
    select: { employeeId: true, detail: true },
  });
  const paidBefore = new Map<string, number>();
  for (const s of earlier) {
    for (const m of ((s.detail as { arrears?: ArrearMonth[] } | null)?.arrears ?? [])) {
      for (const l of m.lines) paidBefore.set(`${s.employeeId}|${m.month}|${l.code}`, (paidBefore.get(`${s.employeeId}|${m.month}|${l.code}`) ?? 0) + l.diff);
    }
  }
  const heads = (await payHeads(boardId, tx)).filter((h) => h.isActive);
  const rules = heads.map(toHeadRule);
  const compared = new Set(heads.filter((h) => COMPARED_CALCS.has(h.calc) && !NOT_COMPARED.has(h.code)).map((h) => h.code));
  const headBy = new Map(heads.map((h) => [h.code, h]));
  const posts = new Map((await tx.post.findMany({ where: { boardId } })).map((p) => [p.id, p]));
  const history = await tx.payHistory.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }] });
  const cache = new Map<string, { rates: Record<string, number>; levels: Record<string, number[]> | null }>();
  const monthData = async (month: string) => {
    if (!cache.has(month)) {
      const start = `${month}-01`;
      const [rates, matrix] = await Promise.all([ratesOn(boardId, start, tx), matrixOn(boardId, start, tx)]);
      cache.set(month, { rates, levels: (matrix?.levels as Record<string, number[]>) ?? null });
    }
    return cache.get(month)!;
  };

  const byPerson = new Map<string, PersonArrears>();
  for (const s of slips.filter((x) => x.run.kind === "REGULAR")) {
    const e = s.employee;
    const { rates, levels } = await monthData(s.month);
    const start = fromISODate(`${s.month}-01`);
    const h = history.find((x) => x.employeeId === e.id && x.effectiveFrom <= start);
    const level = h?.payLevel ?? s.payLevel;
    const cell = h?.payCell ?? s.payCell;
    const post = posts.get(h?.postId ?? s.postId) ?? e.post;
    const lossDays = num(s.lossDays);
    const halfPayDays = num(s.halfPayDays);
    const workedDays = s.workedDays === null ? null : num(s.workedDays);
    const last = lossDays || halfPayDays || workedDays !== null ? { daysInMonth: datesOfMonth(shiftMonth(s.month, -1)).length, lossDays, halfPayDays, workedDays: workedDays ?? 0 } : null;
    const due = computePay({
      type: e.type,
      postCode: post.code,
      group: post.group,
      payLevel: level,
      basic: basicFrom(levels, level, cell),
      wageRate: e.wageRate === null ? null : num(e.wageRate),
      wageBasis: e.wageBasis,
      daysInMonth: s.daysInMonth,
      daysOnRoll: num(s.daysOnRoll),
      last,
      rates,
      heads: rules,
      items: {},
    });
    const drawnLines = s.lines as unknown as PayLine[];
    const codes = new Set([...due.lines.map((l) => l.code), ...drawnLines.map((l) => l.code)].filter((c) => compared.has(c)));
    const lines: ArrearLine[] = [];
    for (const code of codes) {
      const d = due.lines.find((l) => l.code === code)?.amount ?? 0;
      const w = (drawnLines.find((l) => l.code === code)?.amount ?? 0) + (paidBefore.get(`${e.id}|${s.month}|${code}`) ?? 0);
      if (d === w) continue;
      const head = headBy.get(code)!;
      lines.push({ code, name: head.name, nameHi: head.nameHi, kind: head.kind, accountHead: head.accountHead, due: d, drawn: w, diff: fromPaise(toPaise(d) - toPaise(w)) });
    }
    if (!lines.length) continue;
    const p = byPerson.get(e.id) ?? { employeeId: e.id, months: [], gross: 0, deductions: 0, employer: 0, net: 0 };
    p.months.push({ month: s.month, lines });
    for (const l of lines) {
      if (l.kind === "EARNING") p.gross += l.diff;
      else if (l.kind === "DEDUCTION") p.deductions += l.diff;
      else p.employer += l.diff;
    }
    p.net = p.gross - p.deductions;
    byPerson.set(e.id, p);
  }
  return [...byPerson.values()];
}

// ─── Making a supplementary bill ─────────────────────────────────────────────

export const arrearsBillSchema = z.object({
  type: z.literal("ARREARS"),
  payGroup: z.enum(RUN_GROUPS),
  fromMonth: z.string().refine(isMonth, "validation.invalid"),
  toMonth: z.string().refine(isMonth, "validation.invalid"),
  reason: z.string().trim().min(3, "validation.tooShort").max(200),
  employeeIds: z.array(z.string()).max(5000).optional(),
});
export const withheldBillSchema = z.object({ type: z.literal("WITHHELD"), payGroup: z.enum(RUN_GROUPS), payslipIds: z.array(z.string()).min(1, "payroll.supplementary.pickSomeone").max(5000) });
export const joinerBillSchema = z.object({ type: z.literal("JOINER"), payGroup: z.enum(RUN_GROUPS), forMonth: z.string().refine(isMonth, "validation.invalid"), employeeIds: z.array(z.string()).min(1, "payroll.supplementary.pickSomeone").max(5000) });
export const billSchema = z.discriminatedUnion("type", [arrearsBillSchema, withheldBillSchema, joinerBillSchema]);

type Source = SupplementarySource & { payGroup: RunGroup };

/** People of a pay group with arrears for a period — the preview before a bill is made. */
export async function previewArrears(actor: Actor, raw: unknown) {
  if (!canSee(actor)) throw forbidden();
  const input = arrearsBillSchema.parse({ ...(raw as object), type: "ARREARS", reason: (raw as { reason?: string })?.reason || "preview" });
  if (input.toMonth < input.fromMonth) throw badRequest("errors.validation", { toMonth: "payroll.errors.toBeforeFrom" });
  const people = await db.employee.findMany({ where: { boardId: actor.boardId, type: { in: TYPES_IN_GROUP[input.payGroup] }, status: { not: "DRAFT" }, ...(input.employeeIds?.length ? { id: { in: input.employeeIds } } : {}) }, select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true } });
  const arrears = await computeArrears(db, actor.boardId, people.map((p) => p.id), input.fromMonth, input.toMonth);
  const byId = new Map(people.map((p) => [p.id, p]));
  return arrears
    .map((a) => ({ ...a, code: byId.get(a.employeeId)?.employeeCode ?? "", name: fullName(byId.get(a.employeeId)!), nameHi: byId.get(a.employeeId)?.nameHi ?? null, isSelf: a.employeeId === actor.employeeId }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Pay withheld in approved regular bills and not yet paid by a supplementary bill. */
export async function withheldCandidates(actor: Actor, payGroup: RunGroup) {
  if (!canSee(actor)) throw forbidden();
  const withheld = await db.payslip.findMany({
    where: { boardId: actor.boardId, payGroup: payGroup as PayGroup, status: "WITHHELD", run: { kind: "REGULAR", status: { in: [...PAID_STATUSES] } } },
    include: { employee: { select: { employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, bankAccountHash: true, ifsc: true } } },
    orderBy: [{ month: "desc" }],
  });
  const taken = await paidElsewhere(actor.boardId);
  return withheld
    .filter((s) => !taken.has(s.id))
    .map((s) => ({ id: s.id, employeeId: s.employeeId, month: s.month, code: s.employee.employeeCode ?? "", name: fullName(s.employee), nameHi: s.employee.nameHi, net: num(s.net), reason: s.withheldReason, hasBank: Boolean(s.employee.bankAccountHash && s.employee.ifsc), isSelf: s.employeeId === actor.employeeId }));
}

/** Withheld payslips already in a supplementary bill that was not rejected. */
async function paidElsewhere(boardId: string) {
  const supp = await db.payslip.findMany({ where: { boardId, run: { kind: "SUPPLEMENTARY" } }, select: { detail: true } });
  return new Set(supp.map((s) => (s.detail as { withheldSlipId?: string } | null)?.withheldSlipId).filter((x): x is string => Boolean(x)));
}

/** People with no payslip in a month whose regular bill is already approved (joined late in the month). */
export async function joinerCandidates(actor: Actor, payGroup: StaffGroup, forMonth: string) {
  if (!canSee(actor)) throw forbidden();
  if (!isMonth(forMonth)) throw badRequest();
  const regular = await db.payrollRun.findUnique({ where: { boardId_payGroup_month_kind_seq: { boardId: actor.boardId, payGroup: payGroup as PayGroup, month: forMonth, kind: "REGULAR", seq: 0 } } });
  if (!regular || !(PAID_STATUSES as readonly string[]).includes(regular.status)) return { regularApproved: false, people: [] };
  const end = fromISODate(datesOfMonth(forMonth).at(-1)!);
  const people = await db.employee.findMany({
    where: { boardId: actor.boardId, type: { in: TYPES_IN_GROUP[payGroup] }, status: { in: ["ACTIVE", "SUSPENDED"] }, dateOfJoining: { lte: end }, payslips: { none: { month: forMonth } } },
    select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, dateOfJoining: true },
    orderBy: { employeeCode: "asc" },
  });
  return { regularApproved: true, people: people.map((p) => ({ id: p.id, code: p.employeeCode ?? "", name: fullName(p), nameHi: p.nameHi, dateOfJoining: p.dateOfJoining.toISOString().slice(0, 10), isSelf: p.id === actor.employeeId })) };
}

/** The slips and pre-checks for a supplementary bill, from its source. */
async function buildSupplementary(boardId: string, src: Source, month: string): Promise<{ slips: ComputedSlip[]; found: Found[] }> {
  if (src.type === "BENEFITS" || src.payGroup === "PENSION") throw new Error("Pension bills are built by the pension module");
  const dim = datesOfMonth(month).length;
  const bankHolders = new Map((await db.employee.groupBy({ by: ["bankAccountHash"], where: { boardId, bankAccountHash: { not: null }, status: { in: ["ACTIVE", "SUSPENDED"] } }, _count: { _all: true } })).map((h) => [h.bankAccountHash!, h._count._all]));
  if (src.type === "JOINER") {
    const computed = await computeRun(db, boardId, src.payGroup, src.forMonth, { ignoreAttendance: true });
    const slips = computed.slips.filter((s) => src.employeeIds.includes(s.employeeId)).map((s) => ({ ...s, lastNet: null, changePct: null, detail: { ...((s.detail as object) ?? {}), joinerMonth: src.forMonth } }));
    return { slips, found: computed.found.filter((f) => f.employeeId && src.employeeIds.includes(f.employeeId) && f.code !== "NET_CHANGE") };
  }
  const employees = new Map(
    (
      await db.employee.findMany({
        where: { boardId, id: { in: src.type === "ARREARS" ? src.employeeIds : (await db.payslip.findMany({ where: { id: { in: src.payslipIds } }, select: { employeeId: true } })).map((s) => s.employeeId) } },
      })
    ).map((e) => [e.id, e]),
  );
  const slips: ComputedSlip[] = [];
  if (src.type === "ARREARS") {
    for (const a of await computeArrears(db, boardId, src.employeeIds, src.fromMonth, src.toMonth)) {
      const e = employees.get(a.employeeId)!;
      const totals = new Map<string, PayLine>();
      for (const m of a.months) {
        for (const l of m.lines) {
          const t = totals.get(l.code) ?? { code: l.code, name: l.name, nameHi: l.nameHi, kind: l.kind, amount: 0, accountHead: l.accountHead };
          t.amount = fromPaise(toPaise(t.amount) + toPaise(l.diff));
          totals.set(l.code, t);
        }
      }
      slips.push({
        employeeId: e.id,
        sectionId: e.sectionId,
        postId: e.postId,
        payLevel: e.payLevel,
        payCell: e.payCell,
        daysInMonth: dim,
        daysOnRoll: 0,
        lossDays: 0,
        halfPayDays: 0,
        workedDays: null,
        lines: [...totals.values()].filter((l) => l.amount !== 0),
        gross: a.gross,
        deductions: a.deductions,
        net: a.net,
        employer: a.employer,
        bankLast4: e.bankAccountLast4,
        ifsc: e.ifsc,
        lastNet: null,
        changePct: null,
        detail: { arrears: a.months },
      });
    }
  } else {
    const withheld = await db.payslip.findMany({ where: { id: { in: src.payslipIds }, status: "WITHHELD" } });
    for (const w of withheld) {
      const e = employees.get(w.employeeId)!;
      slips.push({
        employeeId: e.id,
        sectionId: w.sectionId,
        postId: w.postId,
        payLevel: w.payLevel,
        payCell: w.payCell,
        daysInMonth: w.daysInMonth,
        daysOnRoll: num(w.daysOnRoll),
        lossDays: num(w.lossDays),
        halfPayDays: num(w.halfPayDays),
        workedDays: w.workedDays === null ? null : num(w.workedDays),
        lines: w.lines as unknown as PayLine[],
        gross: num(w.gross),
        deductions: num(w.deductions),
        net: num(w.net),
        employer: num(w.employer),
        bankLast4: e.bankAccountLast4,
        ifsc: e.ifsc,
        lastNet: null,
        changePct: null,
        detail: { withheldSlipId: w.id, withheldMonth: w.month, loans: ((w.detail as { loans?: LoanDue[] } | null)?.loans ?? []), gpfRefunds: ((w.detail as { gpfRefunds?: GpfRefund[] } | null)?.gpfRefunds ?? []) },
      });
    }
  }
  const found = preChecks(
    slips.map((s) => {
      const e = employees.get(s.employeeId)!;
      return { employeeId: s.employeeId, net: s.net, lastNet: null, hasBank: Boolean(e.bankAccountHash && e.ifsc), bankHash: e.bankAccountHash, afterRetirement: false, noPayLevel: false, suspended: false };
    }),
    bankHolders,
  );
  return { slips, found };
}

/** S-42: makes a supplementary bill (a payroll of its own) and works it out. */
export async function makeSupplementaryBill(actor: Actor, raw: unknown) {
  if (!canMake(actor)) throw forbidden();
  const input = billSchema.parse(raw);
  const month = todayIST().slice(0, 7);
  let src: Source;
  if (input.type === "ARREARS") {
    if (input.toMonth < input.fromMonth) throw badRequest("errors.validation", { toMonth: "payroll.errors.toBeforeFrom" });
    const preview = await previewArrears(actor, input);
    const ids = preview.filter((p) => !p.isSelf).map((p) => p.employeeId);
    if (!ids.length) throw badRequest("payroll.supplementary.nothing");
    src = { type: "ARREARS", payGroup: input.payGroup, employeeIds: ids, fromMonth: input.fromMonth, toMonth: input.toMonth, reason: input.reason };
  } else if (input.type === "WITHHELD") {
    const cands = await withheldCandidates(actor, input.payGroup);
    const chosen = cands.filter((c) => input.payslipIds.includes(c.id));
    if (chosen.some((c) => c.isSelf)) throw forbidden("errors.ownPay");
    if (chosen.length !== input.payslipIds.length) throw badRequest("payroll.supplementary.nothing");
    src = { type: "WITHHELD", payGroup: input.payGroup, payslipIds: input.payslipIds };
  } else {
    const cands = await joinerCandidates(actor, input.payGroup, input.forMonth);
    const chosen = cands.people.filter((p) => input.employeeIds.includes(p.id));
    if (chosen.some((c) => c.isSelf)) throw forbidden("errors.ownPay");
    if (!chosen.length || chosen.length !== input.employeeIds.length) throw badRequest("payroll.supplementary.nothing");
    src = { type: "JOINER", payGroup: input.payGroup, employeeIds: input.employeeIds, forMonth: input.forMonth };
  }
  return saveSupplementary(actor, src, month);
}

async function saveSupplementary(actor: Actor, src: Source, month: string, runId?: string) {
  const computed = await buildSupplementary(actor.boardId, src, month);
  if (!computed.slips.length) throw badRequest("payroll.supplementary.nothing");
  return db.$transaction(async (tx) => {
    const run = await saveRun(tx, actor, src.payGroup, month, computed, { kind: "SUPPLEMENTARY", runId, source: src, title: src.type === "ARREARS" ? src.reason : src.type });
    const saved = await tx.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
    await audit(tx, actor, { action: "RUN", entityType: "PayrollRun", entityId: run.id, summary: `${runId ? "Worked out again" : "Made"} ${titleOf(saved)}: ${computed.slips.length} people, net ${formatINR(num(saved.net))}`, sensitive: true });
    await emit(tx, actor.boardId, "payroll.supplementary", { type: "PayrollRun", id: run.id }, { source: src.type });
    return saved;
  });
}

/** "Work out again" for a supplementary bill still in draft. */
export async function rerunSupplementary(actor: Actor, runId: string) {
  const run = await db.payrollRun.findFirst({ where: { id: runId, boardId: actor.boardId, kind: "SUPPLEMENTARY" } });
  if (!run) throw notFound();
  if (run.payGroup === "PENSION") return rerunPensionBill(actor, run.id);
  if (!canMake(actor)) throw forbidden();
  return saveSupplementary(actor, { ...(run.source as unknown as Source), payGroup: run.payGroup as RunGroup }, run.month, run.id);
}

/** S-42 list: every supplementary bill. */
export async function supplementaryBills(actor: Actor) {
  if (!canSee(actor)) throw forbidden();
  const runs = await db.payrollRun.findMany({ where: { boardId: actor.boardId, kind: "SUPPLEMENTARY", payGroup: { not: "PENSION" } }, orderBy: [{ month: "desc" }, { seq: "desc" }], take: 100 });
  return runs.map((r) => ({ id: r.id, month: r.month, seq: r.seq, payGroup: r.payGroup, status: r.status, employees: r.employees, net: num(r.net), title: titleOf(r), titleHi: titleOf(r, "hi"), reason: r.title }));
}

