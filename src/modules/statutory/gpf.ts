import "server-only";
import { z } from "zod";
import type { ApprovalTask } from "@/generated/prisma/client";
import { submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db, type DbLike, type Tx } from "@/lib/db";
import { formatDate, formatMonth, fromISODate, shiftMonth, todayIST, toISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { formatINR } from "@/lib/money";
import { emit } from "@/lib/outbox";
import { renderPdf } from "@/lib/pdf";
import { isoDateField } from "@/lib/validators";
import { fullName } from "@/modules/employees/present";
import { gpfBalance, gpfInstalment, gpfLimit, gpfYear, monthsOfFy, type GpfMove } from "./gpf-rules";
import { esc, rs, statPage } from "./pdf";
import { fyMonths, fyOfMonth } from "./tax-rules";

/**
 * §9 GPF, S-50: each OPS employee's GPF account — subscriptions and advance instalments from approved pay bills, advances
 * and withdrawals (Payroll sanctions, a Checker checks, an Admin approves), interest credited once a year at the
 * notified rates (an Admin approves), and the annual statement. Employees see their own account.
 */
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const canSee = (actor: Actor) => canAll(actor, "statutory", "view");
const canManage = (actor: Actor) => canAll(actor, "statutory", "create");

export const gpfAdvanceSchema = z
  .object({
    employeeId: z.string().min(1),
    kind: z.enum(["ADVANCE", "WITHDRAWAL"]),
    amount: z.coerce.number().positive("validation.invalid").max(10_000_000),
    instalments: z.coerce.number().int().min(0).max(60),
    purpose: z.string().trim().min(3, "validation.tooShort").max(200),
    orderNumber: z.string().trim().min(3, "validation.tooShort").max(80),
    sanctionDate: isoDateField,
  })
  .refine((v) => v.kind === "WITHDRAWAL" || (v.instalments >= 12 && v.instalments <= 60), { path: ["instalments"], message: "statutory.gpf.instalmentsRange" });

/** A dated rate as a month → value function, read once (GPF interest is notified each quarter). */
export async function monthlyRate(tx: DbLike, boardId: string, key: string) {
  const rows = await tx.payRate.findMany({ where: { boardId, key }, orderBy: { effectiveFrom: "asc" } });
  return (month: string) => {
    let v = 0;
    for (const r of rows) if (toISODate(r.effectiveFrom) <= `${month}-01`) v = num(r.value);
    return v;
  };
}

async function movesOf(tx: DbLike, employeeId: string): Promise<(GpfMove & { id: string; note: string | null; runId: string | null; createdAt: Date })[]> {
  const rows = await tx.gpfEntry.findMany({ where: { employeeId }, orderBy: [{ month: "asc" }, { createdAt: "asc" }] });
  return rows.map((r) => ({ id: r.id, month: r.month, fy: r.fy, kind: r.kind, amount: num(r.amount), note: r.note, runId: r.runId, createdAt: r.createdAt }));
}

/** S-50: every GPF account with its balance, this year's subscriptions and any advance being recovered. */
export async function gpfAccounts(actor: Actor) {
  if (!canSee(actor)) throw forbidden();
  const fy = fyOfMonth(todayIST().slice(0, 7));
  const people = await db.employee.findMany({
    where: { boardId: actor.boardId, OR: [{ type: "PERMANENT_OPS", status: { in: ["ACTIVE", "SUSPENDED"] } }, { gpfEntries: { some: {} } }] },
    select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, gpfNumber: true, status: true, gpfAdvances: { where: { status: { in: ["RUNNING", "PENDING"] } }, include: { entries: { where: { kind: "REFUND" } } } } },
    orderBy: { employeeCode: "asc" },
  });
  const sums = await db.gpfEntry.groupBy({ by: ["employeeId"], where: { boardId: actor.boardId }, _sum: { amount: true } });
  const year = await db.gpfEntry.groupBy({ by: ["employeeId"], where: { boardId: actor.boardId, fy, kind: "SUBSCRIPTION" }, _sum: { amount: true } });
  const balance = new Map(sums.map((s) => [s.employeeId, num(s._sum.amount)]));
  const subscribed = new Map(year.map((s) => [s.employeeId, num(s._sum.amount)]));
  return {
    fy,
    rows: people.map((p) => {
      const adv = p.gpfAdvances.find((a) => a.kind === "ADVANCE" && a.status === "RUNNING");
      return {
        employeeId: p.id,
        code: p.employeeCode ?? "",
        name: fullName(p),
        nameHi: p.nameHi,
        gpfNumber: p.gpfNumber,
        status: p.status,
        balance: balance.get(p.id) ?? 0,
        subscribedThisYear: subscribed.get(p.id) ?? 0,
        advanceLeft: adv ? num(adv.amount) - adv.entries.reduce((s, e) => s + num(e.amount), 0) : 0,
        waiting: p.gpfAdvances.some((a) => a.status === "PENDING"),
      };
    }),
    canManage: canManage(actor),
  };
}

/** One GPF account for a year: the month-by-month working, every entry, advances, and what may be taken out now. */
export async function gpfAccount(actor: Actor, employeeId: string, fyParam?: string) {
  const own = actor.employeeId === employeeId;
  if (!own && !canSee(actor)) throw forbidden();
  const e = await db.employee.findFirst({ where: { id: employeeId, boardId: actor.boardId }, select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, gpfNumber: true, type: true, status: true, dateOfJoining: true } });
  if (!e) throw notFound();
  const today = todayIST();
  const thisFy = fyOfMonth(today.slice(0, 7));
  const fy = fyParam && /^\d{4}-\d{2}$/.test(fyParam) ? fyParam : thisFy;
  const [moves, rateFor, advMax, wdMax, advances] = await Promise.all([
    movesOf(db, employeeId),
    monthlyRate(db, actor.boardId, "GPF_INTEREST"),
    monthlyRate(db, actor.boardId, "GPF_ADVANCE_MAX"),
    monthlyRate(db, actor.boardId, "GPF_WITHDRAWAL_MAX"),
    db.gpfAdvance.findMany({ where: { employeeId }, include: { entries: { where: { kind: "REFUND" }, select: { amount: true } } }, orderBy: { sanctionDate: "desc" } }),
  ]);
  const balance = gpfBalance(moves);
  const month = today.slice(0, 7);
  const years = [...new Set([...moves.map((m) => m.fy), thisFy])].sort().reverse();
  // This year's interest so far runs to the current month (a final payment's working); a past year runs to March.
  const year = gpfYear(moves, fy, rateFor, fy === thisFy ? month : undefined);
  return {
    employee: { id: e.id, code: e.employeeCode ?? "", name: fullName(e), nameHi: e.nameHi, gpfNumber: e.gpfNumber, type: e.type, status: e.status },
    fy,
    years,
    year,
    entries: moves.filter((m) => m.fy === fy).map((m) => ({ id: m.id, month: m.month, kind: m.kind, amount: m.amount, note: m.note, runId: m.runId })),
    balance,
    rate: rateFor(month),
    limits: { advance: gpfLimit(balance, advMax(month)), withdrawal: gpfLimit(balance, wdMax(month)), advancePercent: advMax(month), withdrawalPercent: wdMax(month) },
    advances: advances.map((a) => {
      const recovered = a.entries.reduce((s, x) => s + num(x.amount), 0);
      return { id: a.id, kind: a.kind, purpose: a.purpose, amount: num(a.amount), instalments: a.instalments, instalmentAmount: num(a.instalmentAmount), sanctionDate: toISODate(a.sanctionDate), orderNumber: a.orderNumber, startMonth: a.startMonth, status: a.status, recovered, left: a.kind === "ADVANCE" && a.status !== "REJECTED" ? Math.max(0, num(a.amount) - recovered) : 0 };
    }),
    canSanction: canManage(actor) && !own && e.status === "ACTIVE",
  };
}

/** Advance or withdrawal sent for checking: up to the share of the balance in force, one running advance at a time. */
export async function sanctionGpfAdvance(actor: Actor, raw: unknown) {
  if (!canManage(actor)) throw forbidden();
  const input = gpfAdvanceSchema.parse(raw);
  const e = await db.employee.findFirst({ where: { id: input.employeeId, boardId: actor.boardId, status: "ACTIVE" } });
  if (!e) throw notFound();
  const month = todayIST().slice(0, 7);
  const [moves, max, open] = await Promise.all([
    movesOf(db, e.id),
    monthlyRate(db, actor.boardId, input.kind === "ADVANCE" ? "GPF_ADVANCE_MAX" : "GPF_WITHDRAWAL_MAX"),
    // One item waiting at a time; a second advance only once the running one is paid back.
    db.gpfAdvance.findFirst({ where: { employeeId: e.id, OR: [{ status: "PENDING" }, ...(input.kind === "ADVANCE" ? [{ kind: "ADVANCE" as const, status: "RUNNING" as const }] : [])] } }),
  ]);
  if (!moves.length) throw badRequest("statutory.gpf.noAccount");
  if (open) throw conflict(open.status === "PENDING" ? "statutory.gpf.oneWaiting" : "statutory.gpf.advanceRunning");
  const balance = gpfBalance(moves);
  const limit = gpfLimit(balance, max(month));
  if (input.amount > limit) throw badRequest("errors.validation", { amount: "statutory.gpf.overLimit" });
  const instalmentAmount = input.kind === "ADVANCE" ? gpfInstalment(input.amount, input.instalments) : 0;
  const isAdvance = input.kind === "ADVANCE";
  return db.$transaction(async (tx) => {
    const a = await tx.gpfAdvance.create({
      data: { boardId: actor.boardId, employeeId: e.id, kind: input.kind, purpose: input.purpose, amount: input.amount, instalments: isAdvance ? input.instalments : 0, instalmentAmount, sanctionDate: fromISODate(input.sanctionDate), orderNumber: input.orderNumber, createdById: actor.userId, createdByName: actor.name },
    });
    await submitForApproval(tx, actor, {
      kind: "gpf.advance",
      title: `GPF ${isAdvance ? "advance" : "withdrawal"} ${formatINR(input.amount)}: ${fullName(e)} (${e.employeeCode})`,
      titleHi: `जीपीएफ ${isAdvance ? "अग्रिम" : "निकासी"} ${formatINR(input.amount)}: ${e.nameHi ?? fullName(e)} (${e.employeeCode})`,
      details: {
        summary: isAdvance ? "After the Checker, an Admin approves. Paid back from next month's pay in equal instalments." : "After the Checker, an Admin approves. A withdrawal is not paid back.",
        summaryHi: isAdvance ? "जाँचकर्ता के बाद एडमिन स्वीकृत करते हैं। अगले माह के वेतन से बराबर किस्तों में वापसी।" : "जाँचकर्ता के बाद एडमिन स्वीकृत करते हैं। निकासी वापस नहीं की जाती।",
        link: `/statutory/funds/${e.id}`,
        rows: [
          { label: "GPF balance", labelHi: "जीपीएफ शेष", new: formatINR(balance) },
          { label: "Most allowed", labelHi: "अधिकतम अनुमत", new: `${formatINR(limit)} (${max(month)}% of balance)` },
          { label: "Amount", labelHi: "राशि", new: formatINR(input.amount) },
          ...(isAdvance ? [{ label: "Instalments", labelHi: "किस्तें", new: `${input.instalments} × ${formatINR(instalmentAmount)}` }] : []),
          { label: "Purpose", labelHi: "उद्देश्य", new: input.purpose },
          { label: "Sanction order", labelHi: "स्वीकृति आदेश", new: `${input.orderNumber} dated ${formatDate(input.sanctionDate)}` },
        ],
      } satisfies ApprovalDetails,
      payload: { advanceId: a.id },
      entityType: "GpfAdvance",
      entityId: a.id,
      subjectEmployeeId: e.id,
    });
    return a;
  });
}

export async function onGpfAdvanceApproved(tx: Tx, task: ApprovalTask, advanceId: string) {
  const a = await tx.gpfAdvance.findUniqueOrThrow({ where: { id: advanceId } });
  if (a.status !== "PENDING") throw conflict("errors.alreadyDecided");
  const moves = await movesOf(tx, a.employeeId);
  if (num(a.amount) > gpfBalance(moves)) throw conflict("statutory.gpf.overLimit");
  const month = todayIST().slice(0, 7);
  const isAdvance = a.kind === "ADVANCE";
  await tx.gpfAdvance.update({ where: { id: a.id }, data: isAdvance ? { status: "RUNNING", startMonth: shiftMonth(month, 1) } : { status: "CLOSED", closedMonth: month } });
  await tx.gpfEntry.create({ data: { boardId: a.boardId, employeeId: a.employeeId, month, fy: fyOfMonth(month), kind: a.kind, amount: -num(a.amount), advanceId: a.id, note: `${isAdvance ? "Advance" : "Withdrawal"} ${a.orderNumber}`, createdById: task.makerId } });
  await emit(tx, task.boardId, "gpf.advance.sanctioned", { type: "GpfAdvance", id: a.id }, { employeeId: a.employeeId, kind: a.kind, amount: num(a.amount) });
}

export async function onGpfAdvanceRejected(tx: Tx, advanceId: string) {
  await tx.gpfAdvance.updateMany({ where: { id: advanceId, status: "PENDING" }, data: { status: "REJECTED" } });
}

// ─── Interest ─────────────────────────────────────────────────────────────────

/** The year's interest for every account, worked out at the notified rates — what an Admin approves on 31 March. */
export async function gpfInterestFor(tx: DbLike, boardId: string, fy: string) {
  const [entries, rateFor] = await Promise.all([tx.gpfEntry.findMany({ where: { boardId }, orderBy: { month: "asc" } }), monthlyRate(tx, boardId, "GPF_INTEREST")]);
  const by = new Map<string, GpfMove[]>();
  for (const r of entries) by.set(r.employeeId, [...(by.get(r.employeeId) ?? []), { month: r.month, fy: r.fy, kind: r.kind, amount: num(r.amount) }]);
  return [...by].map(([employeeId, moves]) => {
    const y = gpfYear(moves, fy, rateFor);
    return { employeeId, interest: y.interest, credited: y.interestCredited, closing: y.closing };
  });
}

export async function gpfInterestSummary(actor: Actor, fy: string) {
  if (!canSee(actor)) throw forbidden();
  const rows = await gpfInterestFor(db, actor.boardId, fy);
  const [, last] = fyMonths(fy);
  const pending = await db.approvalTask.findFirst({ where: { boardId: actor.boardId, kind: "gpf.interest", status: "PENDING", entityId: fy } });
  return {
    fy,
    accounts: rows.length,
    interest: rows.reduce((s, r) => s + r.interest, 0),
    credited: rows.some((r) => r.credited !== 0),
    yearOver: todayIST().slice(0, 7) > last,
    waiting: Boolean(pending),
    canPropose: canManage(actor),
  };
}

/** Interest for a finished year goes to an Admin; once approved it is credited to every account on 31 March. */
export async function proposeGpfInterest(actor: Actor, fy: string) {
  if (!canManage(actor)) throw forbidden();
  if (!/^\d{4}-\d{2}$/.test(fy)) throw badRequest("errors.validation");
  const s = await gpfInterestSummary(actor, fy);
  if (!s.yearOver) throw conflict("statutory.gpf.yearNotOver");
  if (s.credited) throw conflict("statutory.gpf.interestDone");
  if (s.waiting) throw conflict("statutory.gpf.oneWaiting");
  return db.$transaction(async (tx) =>
    submitForApproval(tx, actor, {
      kind: "gpf.interest",
      title: `GPF interest ${fy}: ${s.accounts} accounts, ${formatINR(s.interest)}`,
      titleHi: `जीपीएफ ब्याज ${fy}: ${s.accounts} खाते, ${formatINR(s.interest)}`,
      details: {
        summary: "Interest on each month's closing balance at the rates notified for the year, credited on 31 March.",
        summaryHi: "वर्ष के अधिसूचित दरों पर हर माह के अंत शेष पर ब्याज, 31 मार्च को जमा।",
        link: `/statutory/funds?fy=${fy}`,
        rows: [
          { label: "Accounts", labelHi: "खाते", new: String(s.accounts) },
          { label: "Interest", labelHi: "ब्याज", new: formatINR(s.interest) },
        ],
      } satisfies ApprovalDetails,
      payload: { fy },
      entityType: "GpfInterest",
      entityId: fy,
    }),
  );
}

export async function onGpfInterestApproved(tx: Tx, task: ApprovalTask, fy: string) {
  if (await tx.gpfEntry.findFirst({ where: { boardId: task.boardId, fy, kind: "INTEREST" } })) throw conflict("statutory.gpf.interestDone");
  const rows = (await gpfInterestFor(tx, task.boardId, fy)).filter((r) => r.interest > 0);
  const [, last] = fyMonths(fy);
  await tx.gpfEntry.createMany({ data: rows.map((r) => ({ boardId: task.boardId, employeeId: r.employeeId, month: last, fy, kind: "INTEREST" as const, amount: r.interest, note: `Interest for ${fy}`, createdById: task.makerId })) });
  await emit(tx, task.boardId, "gpf.interest.credited", { type: "GpfInterest", id: fy }, { accounts: rows.length, total: rows.reduce((s, r) => s + r.interest, 0) });
}

// ─── Annual statement ─────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = { OPENING: "Balance brought forward", SUBSCRIPTION: "Subscription", REFUND: "Advance refund", ADVANCE: "Advance", WITHDRAWAL: "Withdrawal", INTEREST: "Interest" };

/** The year's GPF statement as a PDF, for the employee and HR & Accounts. */
export async function gpfStatementPdf(actor: Actor, employeeId: string, fy: string) {
  const a = await gpfAccount(actor, employeeId, fy);
  const y = a.year;
  const months = monthsOfFy(fy).filter((m) => y.months.some((x) => x.month === m));
  const body = `
    <h2>Month by month</h2>
    <table><thead><tr><th>Month</th><th class="n">Credits (₹)</th><th class="n">Withdrawn (₹)</th><th class="n">Balance (₹)</th><th class="n">Rate %</th><th class="n">Interest (₹)</th></tr></thead><tbody>
      <tr class="sub"><td>Opening balance</td><td></td><td></td><td class="n">${rs(y.opening)}</td><td></td><td></td></tr>
      ${months.map((m) => { const x = y.months.find((r) => r.month === m)!; return `<tr><td>${esc(formatMonth(m))}</td><td class="n">${x.credits ? rs(x.credits) : ""}</td><td class="n">${x.debits ? rs(x.debits) : ""}</td><td class="n">${rs(x.balance)}</td><td class="n">${x.rate}</td><td class="n">${rs(x.interest)}</td></tr>`; }).join("")}
      <tr class="tot"><td>Year</td><td class="n">${rs(y.credits)}</td><td class="n">${rs(y.debits)}</td><td class="n">${rs(y.closing - y.interestCredited)}</td><td></td><td class="n">${rs(y.interestCredited || y.interest)}</td></tr>
    </tbody></table>
    <p class="small muted">${y.interestCredited ? `Interest of ₹${rs(y.interestCredited)} credited on 31 March.` : `Interest so far, worked out at the notified rates; it is credited on 31 March.`}</p>
    <h2>Entries</h2>
    <table><thead><tr><th>Month</th><th>Entry</th><th>Note</th><th class="n">Amount (₹)</th></tr></thead><tbody>
      ${a.entries.map((m) => `<tr><td>${esc(formatMonth(m.month))}</td><td>${esc(KIND_LABEL[m.kind] ?? m.kind)}</td><td>${esc(m.note ?? (m.runId ? "Pay bill" : ""))}</td><td class="n">${rs(m.amount)}</td></tr>`).join("")}
    </tbody></table>
    <table class="keep" style="margin-top:10px"><tbody><tr class="tot"><td>Closing balance</td><td class="n">₹${rs(y.closing)}</td></tr></tbody></table>`;
  const html = statPage({
    title: "Delhi Cantonment Board — GPF annual statement",
    subtitle: `Financial year ${fy}`,
    meta: [
      ["Name", a.employee.name],
      ["Employee ID", a.employee.code],
      ["GPF account", a.employee.gpfNumber ?? "—"],
      ["Year", fy],
    ],
    body,
    footer: "Computer-generated statement from the Board's pay bills; no signature needed.",
  });
  const pdf = await renderPdf(html);
  await audit(db, actor, { action: "PRINT", entityType: "Employee", entityId: employeeId, summary: `GPF statement ${fy} of ${a.employee.name}`, sensitive: true });
  return { pdf, fileName: `GPF-${a.employee.code}-${fy}.pdf` };
}
