import "server-only";
import { z } from "zod";
import type { EmployeeType } from "@/generated/prisma/enums";
import { submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import type { ApprovalTask } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db, type Tx } from "@/lib/db";
import { addDays, formatDate, fromISODate, isISODate, monthOf, shiftMonth, todayIST, toISODate, type ISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden } from "@/lib/errors";
import { formatINR } from "@/lib/money";
import { emit } from "@/lib/outbox";
import { fullName } from "@/modules/employees/present";
import { applyDuePayChanges, basicFrom, matrixOn, payAsOf } from "./compute";
import { incrementDatesAround, incrementMonthFor, qualifies } from "./pay-rules";

/**
 * PR-06, S-41: the increment due list for 1 January / 1 July. HR confirms the list, a Checker verifies it, then each
 * person's pay moves one cell (from the due date — a list approved in December takes effect on 1 January) and a service
 * book entry is made. A due date already paid in a payroll leaves arrears, worked out on the Arrears screen (PR-08).
 */
const MATRIX_TYPES: EmployeeType[] = ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION"];
/** Lists can be sent up to this many days before the due date. */
const SEND_AHEAD_DAYS = 90;

export const canPreparePay = (actor: Actor) => canAll(actor, "service_book", "create") || canAll(actor, "payroll", "create");
const canSee = (actor: Actor) => canPreparePay(actor) || canAll(actor, "payroll", "view") || canAll(actor, "service_book", "view");

export type IncrementStatus = "ELIGIBLE" | "NOT_YET" | "TOP_OF_LEVEL" | "WAITING" | "DONE";

export interface IncrementRow {
  employeeId: string;
  code: string;
  name: string;
  nameHi: string | null;
  post: string;
  postHi: string;
  section: string;
  sectionHi: string;
  level: string;
  fromCell: number;
  toCell: number | null;
  fromBasic: number;
  toBasic: number | null;
  lastChange: ISODate;
  status: IncrementStatus;
  /** Leave without pay in the last year — the increment may be postponed (FR 26); the Checker sees it. */
  eolDays: number;
  isSelf: boolean;
}

/** The people due an increment on a date, each with their status. */
export async function incrementDueList(actor: Actor, dueDate?: string) {
  if (!canSee(actor)) throw forbidden();
  const today = todayIST();
  const around = incrementDatesAround(today);
  const due: ISODate = dueDate && isISODate(dueDate) && /-(01|07)-01$/.test(dueDate) ? dueDate : around.next;
  await db.$transaction((tx) => applyDuePayChanges(tx, actor.boardId, today));
  const month = Number(due.slice(5, 7)) as 1 | 7;
  const dayBefore = addDays(due, -1);
  const employees = await db.employee.findMany({
    where: { boardId: actor.boardId, status: "ACTIVE", type: { in: MATRIX_TYPES }, dateOfJoining: { lt: fromISODate(due) } },
    include: { post: true, section: true },
    orderBy: { employeeCode: "asc" },
  });
  const ids = employees.map((e) => e.id);
  const [matrix, pays, history, pending, eol] = await Promise.all([
    matrixOn(actor.boardId, due, db),
    payAsOf(db, employees, dayBefore),
    db.payHistory.findMany({ where: { employeeId: { in: ids } }, orderBy: { effectiveFrom: "desc" } }),
    db.approvalTask.findMany({ where: { boardId: actor.boardId, kind: "increment.batch", status: "PENDING" }, select: { payload: true } }),
    db.attendanceMonth.groupBy({ by: ["employeeId"], where: { employeeId: { in: ids }, month: { gte: monthOf(shiftMonthIso(due, -12)), lt: monthOf(due) }, noPayLeave: { gt: 0 } }, _sum: { noPayLeave: true } }),
  ]);
  const waiting = new Set(pending.flatMap((t) => ((t.payload as { dueDate: string; rows: { employeeId: string }[] }).dueDate === due ? (t.payload as { rows: { employeeId: string }[] }).rows.map((r) => r.employeeId) : [])));
  const eolBy = new Map(eol.map((r) => [r.employeeId, Number(r._sum.noPayLeave ?? 0)]));
  const rows: IncrementRow[] = [];
  for (const e of employees) {
    if (e.dateOfRetirement && toISODate(e.dateOfRetirement) < due) continue;
    const own = history.filter((h) => h.employeeId === e.id);
    // Last appointment, promotion or fixation on or before the due date (increments and corrections do not restart the six months).
    const lastFix = own.find((h) => (h.reason === "PROMOTION" || h.reason === "MACP" || h.reason === "INITIAL") && toISODate(h.effectiveFrom) <= due);
    const lastChange = lastFix ? toISODate(lastFix.effectiveFrom) : toISODate(e.dateOfJoining);
    const incMonth = e.incrementMonth ?? incrementMonthFor(lastChange);
    if (incMonth !== month) continue;
    const pay = pays.get(e.id)!;
    if (!pay.payLevel || !pay.payCell) continue;
    const cells = matrix ? (matrix.levels as Record<string, number[]>)[pay.payLevel] : undefined;
    const fromBasic = basicFrom(matrix?.levels, pay.payLevel, pay.payCell) ?? 0;
    const toCell = cells && pay.payCell < cells.length ? pay.payCell + 1 : null;
    const given = own.find((h) => h.reason === "INCREMENT" && toISODate(h.effectiveFrom) === due);
    const done = Boolean(given);
    const status: IncrementStatus = done ? "DONE" : waiting.has(e.id) ? "WAITING" : !qualifies(lastChange, due) ? "NOT_YET" : toCell === null ? "TOP_OF_LEVEL" : "ELIGIBLE";
    rows.push({
      employeeId: e.id,
      code: e.employeeCode ?? "",
      name: fullName(e),
      nameHi: e.nameHi,
      post: e.post.name,
      postHi: e.post.nameHi,
      section: e.section.name,
      sectionHi: e.section.nameHi,
      level: pay.payLevel,
      fromCell: pay.payCell,
      toCell: given ? given.payCell : toCell,
      fromBasic,
      toBasic: given ? basicFrom(matrix?.levels, given.payLevel, given.payCell) : toCell ? (cells?.[toCell - 1] ?? null) : null,
      lastChange,
      status,
      eolDays: eolBy.get(e.id) ?? 0,
      isSelf: e.id === actor.employeeId,
    });
  }
  // A due date already covered by an approved payroll means the increment will be paid as arrears.
  const paidRuns = await db.payrollRun.count({ where: { boardId: actor.boardId, kind: "REGULAR", month: { gte: due.slice(0, 7) }, status: { in: ["APPROVED", "PAID", "CLOSED"] } } });
  return {
    due,
    dates: [around.last, around.next],
    rows,
    canSend: canPreparePay(actor) && due <= addDays(today, SEND_AHEAD_DAYS),
    arrearsLikely: paidRuns > 0,
    sendAheadDays: SEND_AHEAD_DAYS,
  };
}

function shiftMonthIso(date: ISODate, n: number): ISODate {
  return `${shiftMonth(date.slice(0, 7), n)}-01`;
}

export const incrementSubmitSchema = z.object({
  dueDate: z.string().refine((d) => isISODate(d) && /-(01|07)-01$/.test(d), "validation.invalid"),
  employeeIds: z.array(z.string().min(1)).min(1, "payroll.increments.pickSomeone").max(2000),
  orderNumber: z.string().trim().max(80).optional(),
});

/** HR confirms the list: the chosen eligible people go to a Checker as one batch. */
export async function submitIncrements(actor: Actor, raw: unknown) {
  if (!canPreparePay(actor)) throw forbidden();
  const input = incrementSubmitSchema.parse(raw);
  const list = await incrementDueList(actor, input.dueDate);
  if (!list.canSend) throw badRequest("payroll.increments.tooEarly", undefined, { days: SEND_AHEAD_DAYS });
  const chosen = list.rows.filter((r) => input.employeeIds.includes(r.employeeId));
  if (chosen.some((r) => r.isSelf)) throw forbidden("errors.ownPay");
  if (chosen.length !== input.employeeIds.length || chosen.some((r) => r.status !== "ELIGIBLE")) throw conflict("payroll.increments.notEligible");
  const rows = chosen.map((r) => ({ employeeId: r.employeeId, code: r.code, name: r.name, level: r.level, fromCell: r.fromCell, toCell: r.toCell!, fromBasic: r.fromBasic, toBasic: r.toBasic! }));
  return db.$transaction(async (tx) => {
    const task = await submitForApproval(tx, actor, {
      kind: "increment.batch",
      title: `Annual increment ${formatDate(input.dueDate)}: ${rows.length} people`,
      titleHi: `वार्षिक वेतन वृद्धि ${formatDate(input.dueDate, "hi")}: ${rows.length} कर्मचारी`,
      details: {
        summary: "Each person moves one cell in their level from the due date; a service book entry is made for each.",
        summaryHi: "हर व्यक्ति देय तिथि से अपने लेवल में एक सेल आगे जाता है; हर एक की सेवा पुस्तिका में प्रविष्टि होती है।",
        link: `/payroll/increments?date=${input.dueDate}`,
        rows: rows.map((r) => ({ label: `${r.code} · ${r.name}`, old: `L${r.level} C${r.fromCell} · ${formatINR(r.fromBasic)}`, new: `L${r.level} C${r.toCell} · ${formatINR(r.toBasic)}` })),
      } satisfies ApprovalDetails,
      payload: { dueDate: input.dueDate, orderNumber: input.orderNumber ?? null, rows },
      entityType: "IncrementBatch",
      entityId: input.dueDate,
    });
    await audit(tx, actor, { action: "SUBMIT", entityType: "IncrementBatch", entityId: input.dueDate, summary: `Sent the ${formatDate(input.dueDate)} increments of ${rows.length} people to a Checker` });
    return task;
  });
}

export interface IncrementPayload {
  dueDate: ISODate;
  orderNumber: string | null;
  rows: { employeeId: string; code: string; name: string; level: string; fromCell: number; toCell: number; fromBasic: number; toBasic: number }[];
}

/**
 * A pay change recorded back-dated (a promotion, MACP or an increment from an earlier date) restates the annual
 * increments already recorded after it, up to the next promotion or MACP: each is again one cell above the pay before
 * it, or is withdrawn when the person no longer gets it on that date (not their increment month, under six months in
 * the level, or the top of the level). The record then shows the pay in force today. Returns how many changed.
 */
export async function restateLaterIncrements(tx: Tx, boardId: string, employeeId: string, after: ISODate, why: { en: string; hi: string }) {
  const e = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
  let live = await tx.payHistory.findMany({ where: { employeeId }, orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }] });
  let changed = 0;
  for (const h of [...live]) {
    const date = toISODate(h.effectiveFrom);
    if (date <= after) continue;
    if (h.reason === "PROMOTION" || h.reason === "MACP") break;
    if (h.reason !== "INCREMENT") continue;
    const earlier = live.filter((x) => x.id !== h.id && toISODate(x.effectiveFrom) < date);
    const before = earlier.at(-1);
    if (!before) continue;
    const lastFix = [...earlier].reverse().find((x) => x.reason === "PROMOTION" || x.reason === "MACP" || x.reason === "INITIAL");
    const lastChange = lastFix ? toISODate(lastFix.effectiveFrom) : toISODate(e.dateOfJoining);
    const levels = (await matrixOn(boardId, date, tx))?.levels as Record<string, number[]> | undefined;
    const cells = levels?.[before.payLevel];
    const toCell = cells && before.payCell < cells.length ? before.payCell + 1 : null;
    const entry = h.serviceEntryId ? await tx.serviceBookEntry.findUnique({ where: { id: h.serviceEntryId } }) : null;
    if (toCell === null || Number(date.slice(5, 7)) !== (e.incrementMonth ?? incrementMonthFor(lastChange)) || !qualifies(lastChange, date)) {
      await tx.payHistory.delete({ where: { id: h.id } });
      if (entry) await tx.serviceBookEntry.update({ where: { id: entry.id }, data: { status: "REJECTED", details: `${entry.details} — withdrawn after the ${why.en}`, detailsHi: entry.detailsHi ? `${entry.detailsHi} — ${why.hi} के बाद वापस` : null } });
      live = live.filter((x) => x.id !== h.id);
      changed++;
      continue;
    }
    if (before.payLevel === h.payLevel && toCell === h.payCell) continue;
    const fromBasic = basicFrom(levels, before.payLevel, before.payCell) ?? 0;
    const toBasic = basicFrom(levels, before.payLevel, toCell) ?? 0;
    await tx.payHistory.update({ where: { id: h.id }, data: { payLevel: before.payLevel, payCell: toCell } });
    if (entry) {
      await tx.serviceBookEntry.update({
        where: { id: entry.id },
        data: {
          details: `Annual increment: Level ${before.payLevel}, cell ${before.payCell} → ${toCell} (${formatINR(fromBasic)} → ${formatINR(toBasic)}) — restated after the ${why.en}`,
          detailsHi: `वार्षिक वेतन वृद्धि: लेवल ${before.payLevel}, सेल ${before.payCell} → ${toCell} (${formatINR(fromBasic)} → ${formatINR(toBasic)}) — ${why.hi} के बाद संशोधित`,
          data: { fromLevel: before.payLevel, fromCell: before.payCell, toLevel: before.payLevel, toCell },
        },
      });
    }
    live = live.map((x) => (x.id === h.id ? { ...x, payLevel: before.payLevel, payCell: toCell } : x));
    changed++;
  }
  const now = live.filter((x) => toISODate(x.effectiveFrom) <= todayIST()).at(-1);
  if (now) await tx.employee.update({ where: { id: employeeId }, data: { payLevel: now.payLevel, payCell: now.payCell, ...(now.postId ? { postId: now.postId } : {}) } });
  return changed;
}

/** The Checker verified the list: pay history, the record (once the date has come) and the service book. */
export async function applyIncrements(tx: Tx, task: ApprovalTask, actor: Actor, p: IncrementPayload) {
  const today = todayIST();
  for (const r of p.rows) {
    if (r.employeeId === actor.employeeId) throw forbidden("errors.ownPay");
    const already = await tx.payHistory.findFirst({ where: { employeeId: r.employeeId, reason: "INCREMENT", effectiveFrom: fromISODate(p.dueDate) } });
    if (already) continue;
    const entry = await tx.serviceBookEntry.create({
      data: {
        employeeId: r.employeeId,
        event: "INCREMENT",
        eventDate: fromISODate(p.dueDate),
        orderNumber: p.orderNumber,
        details: `Annual increment: Level ${r.level}, cell ${r.fromCell} → ${r.toCell} (${formatINR(r.fromBasic)} → ${formatINR(r.toBasic)})`,
        detailsHi: `वार्षिक वेतन वृद्धि: लेवल ${r.level}, सेल ${r.fromCell} → ${r.toCell} (${formatINR(r.fromBasic)} → ${formatINR(r.toBasic)})`,
        data: { fromLevel: r.level, fromCell: r.fromCell, toLevel: r.level, toCell: r.toCell },
        status: "APPROVED",
        createdById: task.makerId,
        approvedById: actor.userId,
      },
    });
    await tx.payHistory.create({
      data: { boardId: task.boardId, employeeId: r.employeeId, effectiveFrom: fromISODate(p.dueDate), payLevel: r.level, payCell: r.toCell, reason: "INCREMENT", serviceEntryId: entry.id, createdById: task.makerId },
    });
  }
  await applyDuePayChanges(tx, task.boardId, today);
  // A list for a past date given after a later increment was recorded: the later ones move up a cell.
  for (const r of p.rows) await restateLaterIncrements(tx, task.boardId, r.employeeId, p.dueDate, { en: `increment of ${formatDate(p.dueDate)} given later`, hi: `${formatDate(p.dueDate, "hi")} की वेतन वृद्धि बाद में दिए जाने` });
  await emit(tx, task.boardId, "increments.approved", { type: "IncrementBatch", id: p.dueDate }, { people: p.rows.length });
}
