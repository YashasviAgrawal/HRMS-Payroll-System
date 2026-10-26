import "server-only";
import { z } from "zod";
import type { ApprovalTask } from "@/generated/prisma/client";
import { cancelTask, chainTask, decide, decisionBlocker, submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import { can, canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db, type DbLike, type Tx } from "@/lib/db";
import { isMonth, shiftMonth, todayIST } from "@/lib/dates";
import { AppError, badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { formatINR } from "@/lib/money";
import { emit } from "@/lib/outbox";
import type { RequestMeta } from "@/lib/request-meta";
import { checkOtp, startSignOtp } from "@/modules/auth/service";
import { fullName } from "@/modules/employees/present";
import { EXCEPTION_RULES, type ExceptionCode, type Resolution } from "./checks";
import { applyResolutions, computeRun, RUN_GROUPS, runTitle, saveRun, type RunGroup } from "./compute";
import type { PayLine } from "./engine";

export { RUN_GROUPS, runTitle, type RunGroup };

/** How long a used approve-and-sign OTP stays good for the approval it was asked for. */
const SIGN_OTP_WINDOW_MS = 3 * 60 * 1000;
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

/**
 * S-40 Payroll month (PRD §8): one screen, five stages.
 *
 *   1 Run              Payroll (HR & A) works out every person's pay for a pay group and month.
 *   2 Fix exceptions   PR-10 pre-checks: fix the record and work it out again, or resolve (withhold / explain).
 *   3 Check            A Checker reviews totals by section and every change over 25%, forwards or returns.
 *   4 Approve and sign An Admin holding Approver + Pay bill signer approves with an OTP (or returns).
 *   5 Pay              Bank file → Admin releases it → downloaded and uploaded; return file of failed credits
 *                      read and re-paid; month closed with the accounting summary (PR-14).
 *
 * PR-13: after approval only an Admin can reopen, with a reason, and only until the bank file is released.
 * Rule 2 (nobody processes their own pay) applies to every per-person action inside a run (D-06).
 */

// ─── Stage 1: run ─────────────────────────────────────────────────────────────

export const runSchema = z.object({
  payGroup: z.enum(RUN_GROUPS),
  month: z.string().refine(isMonth, "validation.invalid"),
});

const canRun = (actor: Actor) => canAll(actor, "payroll", "create");

export async function runPayroll(actor: Actor, raw: unknown) {
  if (!canRun(actor)) throw forbidden();
  const input = runSchema.parse(raw);
  const thisMonth = todayIST().slice(0, 7);
  if (input.month > thisMonth) throw badRequest("errors.validation", { month: "payroll.errors.futureMonth" });
  const started = Date.now();
  const computed = await computeRun(db, actor.boardId, input.payGroup, input.month);
  if (!computed.slips.length) throw badRequest("payroll.errors.nobody");
  return db.$transaction(
    async (tx) => {
      const run = await saveRun(tx, actor, input.payGroup, input.month, computed);
      const saved = await tx.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
      await audit(tx, actor, {
        action: "RUN",
        entityType: "PayrollRun",
        entityId: run.id,
        summary: `${saved.version > 1 ? "Worked out again" : "Ran"} ${runTitle(input.payGroup, input.month)}: ${computed.slips.length} people, net ${formatINR(num(saved.net))}, ${computed.found.length} exceptions (${Date.now() - started} ms)`,
        newValue: { version: saved.version, employees: saved.employees, gross: num(saved.gross), net: num(saved.net), exceptions: computed.found.length },
        sensitive: true,
      });
      await emit(tx, actor.boardId, "payroll.run", { type: "PayrollRun", id: run.id }, { payGroup: input.payGroup, month: input.month, version: saved.version });
      return saved;
    },
    { timeout: 60_000 },
  );
}

// ─── Reading ──────────────────────────────────────────────────────────────────

function assertView(actor: Actor) {
  if (!canAll(actor, "payroll", "view")) throw forbidden();
}

/** S-40 home: this month's runs per pay group, and the history. */
export async function payrollOverview(actor: Actor, month?: string) {
  assertView(actor);
  const current = month && isMonth(month) ? month : todayIST().slice(0, 7);
  const runs = await db.payrollRun.findMany({ where: { boardId: actor.boardId, payGroup: { in: [...RUN_GROUPS] } }, orderBy: [{ month: "desc" }, { payGroup: "asc" }], take: 60 });
  const ids = runs.filter((r) => r.month === current).map((r) => r.id);
  const open = ids.length
    ? await db.payrollException.groupBy({ by: ["runId"], where: { runId: { in: ids }, resolution: null }, _count: { _all: true } })
    : [];
  const openBy = new Map(open.map((o) => [o.runId, o._count._all]));
  return {
    month: current,
    groups: RUN_GROUPS.map((g) => {
      const run = runs.find((r) => r.month === current && r.payGroup === g) ?? null;
      return { group: g, run: run ? { ...run, gross: num(run.gross), deductions: num(run.deductions), net: num(run.net), employer: num(run.employer), openExceptions: openBy.get(run.id) ?? 0 } : null };
    }),
    history: runs.filter((r) => r.month !== current).map((r) => ({ ...r, gross: num(r.gross), deductions: num(r.deductions), net: num(r.net), employer: num(r.employer) })),
    canRun: canRun(actor),
  };
}

async function loadRun(actor: Actor, runId: string, tx: DbLike = db) {
  const run = await tx.payrollRun.findFirst({ where: { id: runId, boardId: actor.boardId } });
  if (!run) throw notFound();
  return run;
}

/** Everything the S-40 run screen shows, and what this person may do at this stage. */
export async function getRun(actor: Actor, runId: string) {
  assertView(actor);
  const run = await loadRun(actor, runId);
  const [slips, exceptions, tasks, bankFile, sections, previous] = await Promise.all([
    db.payslip.findMany({
      where: { runId },
      include: { employee: { select: { employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, type: true, post: { select: { code: true, name: true, nameHi: true } } } } },
    }),
    db.payrollException.findMany({ where: { runId }, orderBy: [{ severity: "asc" }, { code: "asc" }, { createdAt: "asc" }] }),
    db.approvalTask.findMany({ where: { boardId: actor.boardId, entityType: "PayrollRun", entityId: runId }, orderBy: { createdAt: "asc" } }),
    run.bankFileId ? db.fileRecord.findUnique({ where: { id: run.bankFileId } }) : null,
    db.section.findMany({ where: { boardId: actor.boardId }, select: { id: true, code: true, name: true, nameHi: true } }),
    db.payrollRun.findUnique({ where: { boardId_payGroup_month: { boardId: actor.boardId, payGroup: run.payGroup, month: shiftMonth(run.month, -1) } } }),
  ]);
  const repayIds = [...new Set(slips.map((s) => s.repayFileId).filter((x): x is string => Boolean(x)))];
  const fileIds = [...repayIds, ...(run.summaryFileId ? [run.summaryFileId] : [])];
  const files = fileIds.length ? await db.fileRecord.findMany({ where: { id: { in: fileIds } } }) : [];
  const sectionBy = new Map(sections.map((s) => [s.id, s]));
  const people = slips
    .map((s) => ({
      id: s.id,
      employeeId: s.employeeId,
      code: s.employee.employeeCode ?? "",
      name: fullName(s.employee),
      nameHi: s.employee.nameHi,
      type: s.employee.type,
      post: s.employee.post,
      sectionId: s.sectionId,
      section: sectionBy.get(s.sectionId) ?? null,
      payLevel: s.payLevel,
      payCell: s.payCell,
      status: s.status,
      withheldReason: s.withheldReason,
      daysInMonth: s.daysInMonth,
      daysOnRoll: num(s.daysOnRoll),
      lossDays: num(s.lossDays),
      halfPayDays: num(s.halfPayDays),
      workedDays: s.workedDays === null ? null : num(s.workedDays),
      lines: s.lines as unknown as PayLine[],
      gross: num(s.gross),
      deductions: num(s.deductions),
      net: num(s.net),
      employer: num(s.employer),
      bankLast4: s.bankLast4,
      lastNet: s.lastNet === null ? null : num(s.lastNet),
      changePct: s.changePct === null ? null : num(s.changePct),
      creditStatus: s.creditStatus,
      creditNote: s.creditNote,
      repayFileId: s.repayFileId,
      isSelf: s.employeeId === actor.employeeId,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const nameBy = new Map(people.map((p) => [p.employeeId, p]));

  // Totals by section (what the Checker reviews) — included people only.
  const bySection = new Map<string, { sectionId: string; name: string; nameHi: string; people: number; gross: number; deductions: number; net: number; lastNet: number }>();
  for (const p of people) {
    if (p.status !== "INCLUDED") continue;
    const s = bySection.get(p.sectionId) ?? { sectionId: p.sectionId, name: p.section?.name ?? "", nameHi: p.section?.nameHi ?? "", people: 0, gross: 0, deductions: 0, net: 0, lastNet: 0 };
    s.people += 1;
    s.gross += p.gross;
    s.deductions += p.deductions;
    s.net += p.net;
    s.lastNet += p.lastNet ?? 0;
    bySection.set(p.sectionId, s);
  }
  // Totals by head (the pay bill's abstract).
  const byHead = new Map<string, { code: string; name: string; nameHi: string; kind: string; accountHead: string; amount: number }>();
  for (const p of people) {
    if (p.status !== "INCLUDED") continue;
    for (const l of p.lines) {
      const h = byHead.get(l.code) ?? { code: l.code, name: l.name, nameHi: l.nameHi, kind: l.kind, accountHead: l.accountHead, amount: 0 };
      h.amount += l.amount;
      byHead.set(l.code, h);
    }
  }

  const pendingTask = tasks.find((t) => t.status === "PENDING") ?? null;
  const lastDecision = [...tasks].reverse().find((t) => t.status === "RETURNED" || t.status === "REJECTED") ?? null;
  const open = exceptions.filter((x) => !x.resolution).length;
  const released = bankFile ? bankFile.status === "APPROVED" || bankFile.status === "DOWNLOADED" : false;
  const isMaker = run.runById === actor.userId;
  const failed = people.filter((p) => p.creditStatus === "FAILED" && !p.repayFileId).length;
  const mayDecide = pendingTask ? decisionBlocker(actor, pendingTask) === null : false;

  return {
    run: { ...run, gross: num(run.gross), deductions: num(run.deductions), net: num(run.net), employer: num(run.employer) },
    title: runTitle(run.payGroup as RunGroup, run.month),
    titleHi: runTitle(run.payGroup as RunGroup, run.month, "hi"),
    people,
    exceptions: exceptions.map((x) => ({
      ...x,
      vars: (x.vars ?? {}) as Record<string, string | number>,
      person: x.employeeId ? (nameBy.get(x.employeeId) ?? null) : null,
      allowed: EXCEPTION_RULES[x.code as ExceptionCode]?.resolutions ?? [],
      isSelf: Boolean(x.employeeId && x.employeeId === actor.employeeId),
    })),
    sections: [...bySection.values()].sort((a, b) => a.name.localeCompare(b.name)),
    heads: [...byHead.values()],
    previous: previous ? { id: previous.id, net: num(previous.net), employees: previous.employees, status: previous.status } : null,
    tasks: tasks.map((t) => ({ id: t.id, kind: t.kind, status: t.status, makerName: t.makerName, deciderName: t.deciderName, decisionNote: t.decisionNote, makerNote: t.makerNote, createdAt: t.createdAt, decidedAt: t.decidedAt })),
    lastReturn: lastDecision && run.status === "DRAFT" ? { by: lastDecision.deciderName, note: lastDecision.decisionNote, at: lastDecision.decidedAt } : null,
    bankFile: bankFile ? { id: bankFile.id, status: bankFile.status, fileName: bankFile.fileName, sha256: bankFile.sha256, downloadCount: bankFile.downloadCount } : null,
    files: files.map((f) => ({ id: f.id, kind: f.kind, status: f.status, fileName: f.fileName })),
    open,
    failed,
    can: {
      run: run.status === "DRAFT" && canRun(actor),
      resolve: run.status === "DRAFT" && canRun(actor),
      submit: run.status === "DRAFT" && canRun(actor) && open === 0 && run.employees > 0,
      withdraw: run.status === "CHECKING" && pendingTask?.makerId === actor.userId,
      check: run.status === "CHECKING" && pendingTask?.kind === "payroll.check" && mayDecide,
      approve: run.status === "APPROVING" && pendingTask?.kind === "payroll.approve" && mayDecide && can(actor, "payroll", "approve"),
      reopen: run.status === "APPROVED" && !released && can(actor, "payroll", "approve"),
      bankFile: run.status === "APPROVED" && canRun(actor) && (!bankFile || bankFile.status === "REJECTED"),
      returnFile: run.status === "PAID" && canRun(actor) && !run.returnAt,
      repay: run.status === "PAID" && canRun(actor) && failed > 0,
      close: run.status === "PAID" && canRun(actor) && Boolean(run.returnAt) && failed === 0,
      print: true,
    },
    isMaker,
  };
}

// ─── Stage 2: fix exceptions ──────────────────────────────────────────────────

export const resolveSchema = z.object({
  resolution: z.enum(["EXPLAINED", "WITHHELD", "WAIVED"]),
  note: z.string().trim().min(5, "validation.tooShort").max(500),
});

export async function resolveException(actor: Actor, runId: string, exceptionId: string, raw: unknown) {
  if (!canRun(actor)) throw forbidden();
  const input = resolveSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const run = await loadRun(actor, runId, tx);
    if (run.status !== "DRAFT") throw conflict("payroll.errors.notDraft");
    const x = await tx.payrollException.findFirst({ where: { id: exceptionId, runId } });
    if (!x) throw notFound();
    if (x.employeeId && x.employeeId === actor.employeeId) throw forbidden("errors.ownPay");
    if (!EXCEPTION_RULES[x.code as ExceptionCode]?.resolutions.includes(input.resolution as Resolution)) throw badRequest("payroll.errors.resolutionNotAllowed");
    if (!x.employeeId && input.resolution === "WITHHELD" && actor.employeeId) {
      // A section's pay held back must not include the person doing it.
      const ids = String((x.vars as Record<string, unknown> | null)?.employeeIds ?? "").split(",");
      if (ids.includes(actor.employeeId)) throw forbidden("errors.ownPay");
    }
    await tx.payrollException.update({ where: { id: x.id }, data: { resolution: input.resolution, note: input.note, resolvedById: actor.userId, resolvedByName: actor.name, resolvedAt: new Date() } });
    await applyResolutions(tx, runId);
    await audit(tx, actor, { action: "RESOLVE", entityType: "PayrollRun", entityId: runId, summary: `${x.code} → ${input.resolution}: ${input.note}`, newValue: { exceptionId: x.id, employeeId: x.employeeId, resolution: input.resolution } });
  });
}

/** Undo a resolution (while the run is still a draft). */
export async function clearResolution(actor: Actor, runId: string, exceptionId: string) {
  if (!canRun(actor)) throw forbidden();
  return db.$transaction(async (tx) => {
    const run = await loadRun(actor, runId, tx);
    if (run.status !== "DRAFT") throw conflict("payroll.errors.notDraft");
    const x = await tx.payrollException.findFirst({ where: { id: exceptionId, runId } });
    if (!x) throw notFound();
    if (x.employeeId && x.employeeId === actor.employeeId) throw forbidden("errors.ownPay");
    await tx.payrollException.update({ where: { id: x.id }, data: { resolution: null, note: null, resolvedById: null, resolvedByName: null, resolvedAt: null } });
    await applyResolutions(tx, runId);
    await audit(tx, actor, { action: "RESOLVE", entityType: "PayrollRun", entityId: runId, summary: `${x.code}: resolution cleared` });
  });
}

// ─── Stage 3: check ───────────────────────────────────────────────────────────

function runDetails(run: { id: string; employees: number; gross: unknown; deductions: unknown; net: unknown; version: number }, extra: NonNullable<ApprovalDetails["rows"]> = []): ApprovalDetails {
  return {
    summary: "Open the payroll to review totals by section and every change over 25% before you decide.",
    summaryHi: "निर्णय से पहले वेतन खोलें — अनुभाग-वार योग और 25% से अधिक हर बदलाव देखें।",
    link: `/payroll/${run.id}`,
    decideAt: `/payroll/${run.id}`,
    rows: [
      { label: "People paid", labelHi: "भुगतान वाले कर्मचारी", new: String(run.employees) },
      { label: "Gross", labelHi: "सकल", new: formatINR(num(run.gross as never)) },
      { label: "Deductions", labelHi: "कटौतियाँ", new: formatINR(num(run.deductions as never)) },
      { label: "Net pay", labelHi: "शुद्ध वेतन", new: formatINR(num(run.net as never)) },
      ...extra,
    ],
  };
}

export async function submitRun(actor: Actor, runId: string, raw: unknown) {
  if (!canRun(actor)) throw forbidden();
  const { note } = z.object({ note: z.string().trim().max(500).optional() }).parse(raw ?? {});
  return db.$transaction(async (tx) => {
    const run = await loadRun(actor, runId, tx);
    if (run.status !== "DRAFT") throw conflict("payroll.errors.notDraft");
    const open = await tx.payrollException.count({ where: { runId, resolution: null } });
    if (open) throw badRequest("payroll.errors.openExceptions", undefined, { count: open });
    if (run.employees === 0) throw badRequest("payroll.errors.nobody");
    const warnings = await tx.payrollException.count({ where: { runId, code: "NET_CHANGE" } });
    const withheld = await tx.payslip.count({ where: { runId, status: "WITHHELD" } });
    await submitForApproval(tx, actor, {
      kind: "payroll.check",
      title: runTitle(run.payGroup as RunGroup, run.month),
      titleHi: runTitle(run.payGroup as RunGroup, run.month, "hi"),
      details: runDetails(run, [
        { label: "Changes over 25%", labelHi: "25% से अधिक बदलाव", new: String(warnings) },
        { label: "Pay withheld", labelHi: "रोका गया वेतन", new: String(withheld) },
      ]),
      payload: { runId },
      entityType: "PayrollRun",
      entityId: runId,
      note: note || null,
    });
    await tx.payrollRun.update({ where: { id: runId }, data: { status: "CHECKING", submittedAt: new Date() } });
  });
}

/** The maker takes a run back from the Checker before it is decided. */
export async function withdrawRun(actor: Actor, runId: string) {
  const run = await loadRun(actor, runId);
  if (run.status !== "CHECKING") throw conflict("payroll.errors.wrongStage");
  const task = await db.approvalTask.findFirst({ where: { entityType: "PayrollRun", entityId: runId, status: "PENDING", kind: "payroll.check" } });
  if (!task) throw conflict("errors.alreadyDecided");
  await cancelTask(actor, task.id);
}

const decisionSchema = z.object({
  decision: z.enum(["APPROVE", "RETURN"]),
  note: z.string().trim().max(1000).optional(),
});

async function pendingTaskOf(actor: Actor, runId: string, kind: string) {
  const task = await db.approvalTask.findFirst({ where: { boardId: actor.boardId, entityType: "PayrollRun", entityId: runId, status: "PENDING", kind } });
  if (!task) throw conflict("payroll.errors.wrongStage");
  return task;
}

/** Checker: forward to the Admin, or return to Payroll with remarks. */
export async function checkRun(actor: Actor, runId: string, raw: unknown) {
  const input = decisionSchema.parse(raw);
  const task = await pendingTaskOf(actor, runId, "payroll.check");
  return decide(actor, task.id, input.decision, input.note);
}

// ─── Stage 4: approve and sign ────────────────────────────────────────────────

/** Sends the approve-and-sign OTP to the Admin's mobile. */
export async function startSigning(actor: Actor, runId: string, meta: RequestMeta) {
  const run = await loadRun(actor, runId);
  if (run.status !== "APPROVING") throw conflict("payroll.errors.wrongStage");
  if (!can(actor, "payroll", "approve") || !can(actor, "payroll", "sign")) throw forbidden();
  const task = await pendingTaskOf(actor, runId, "payroll.approve");
  const blocker = decisionBlocker(actor, task);
  if (blocker) throw forbidden(blocker);
  return startSignOtp(actor, meta, { kind: "PayrollRun", id: runId, what: `pay bill ${run.month} ${run.payGroup}` });
}

const approveSchema = decisionSchema.extend({ challengeId: z.string().optional(), otp: z.string().regex(/^\d{6}$/, "validation.otp").optional() });

export async function approveRun(actor: Actor, runId: string, raw: unknown) {
  const input = approveSchema.parse(raw);
  const task = await pendingTaskOf(actor, runId, "payroll.approve");
  if (input.decision === "APPROVE") {
    if (!can(actor, "payroll", "approve") || !can(actor, "payroll", "sign")) throw forbidden();
    if (!input.challengeId || !input.otp) throw badRequest("errors.validation", { otp: "validation.required" });
    const challenge = await checkOtp(input.challengeId, input.otp, "APPROVE_SIGN", actor.userId);
    const ctx = challenge.context as { kind?: string; id?: string } | null;
    if (ctx?.kind !== "PayrollRun" || ctx.id !== runId) throw new AppError(400, "otp_expired", "errors.otpExpired");
  }
  return decide(actor, task.id, input.decision, input.note);
}

/** Called from the approval kind: the OTP must have been used by this person for this run moments ago. */
async function assertSigned(tx: Tx, actor: Actor, runId: string) {
  const used = await tx.otpChallenge.findMany({
    where: { userId: actor.userId, purpose: "APPROVE_SIGN", consumedAt: { gte: new Date(Date.now() - SIGN_OTP_WINDOW_MS) } },
    select: { context: true },
  });
  if (!used.some((c) => (c.context as { kind?: string; id?: string } | null)?.id === runId)) throw badRequest("payroll.errors.otpNeeded");
}

// ─── Decisions (called by the approval kinds) ────────────────────────────────

export async function onChecked(tx: Tx, task: ApprovalTask, actor: Actor, runId: string) {
  const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== "CHECKING") throw conflict("payroll.errors.wrongStage");
  await tx.payrollRun.update({ where: { id: runId }, data: { status: "APPROVING", checkedById: actor.userId, checkedByName: actor.name } });
  await chainTask(tx, task, {
    kind: "payroll.approve",
    requiredPermission: "PAY_BILL_SIGNER",
    details: runDetails(run, [{ label: "Checked by", labelHi: "जाँचकर्ता", new: actor.name }]),
    payload: { runId },
  });
}

export async function onApproved(tx: Tx, actor: Actor, runId: string) {
  const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== "APPROVING") throw conflict("payroll.errors.wrongStage");
  if (!can(actor, "payroll", "approve")) throw forbidden();
  await assertSigned(tx, actor, runId);
  await tx.payrollRun.update({ where: { id: runId }, data: { status: "APPROVED", approvedById: actor.userId, approvedByName: actor.name, approvedAt: new Date() } });
  await audit(tx, actor, { action: "SIGN", entityType: "PayrollRun", entityId: runId, summary: `Approved and signed with OTP: ${runTitle(run.payGroup as RunGroup, run.month)} (net ${formatINR(num(run.net))})` });
  await emit(tx, run.boardId, "payroll.approved", { type: "PayrollRun", id: runId }, { month: run.month, payGroup: run.payGroup, net: num(run.net) });
}

/** Returned by the Checker or the Admin, or withdrawn by the maker: back to a draft that can be worked out again. */
export async function onSentBack(tx: Tx, runId: string) {
  await tx.payrollRun.update({ where: { id: runId }, data: { status: "DRAFT", submittedAt: null, checkedById: null, checkedByName: null } });
}

// ─── PR-13: reopen ────────────────────────────────────────────────────────────

export async function reopenRun(actor: Actor, runId: string, raw: unknown) {
  if (!can(actor, "payroll", "approve")) throw forbidden();
  const { note } = z.object({ note: z.string().trim().min(10, "validation.tooShort").max(500) }).parse(raw);
  return db.$transaction(async (tx) => {
    const run = await loadRun(actor, runId, tx);
    if (run.status !== "APPROVED") throw conflict("payroll.errors.cannotReopen");
    if (run.bankFileId) {
      const file = await tx.fileRecord.findUnique({ where: { id: run.bankFileId } });
      if (file && (file.status === "APPROVED" || file.status === "DOWNLOADED")) throw conflict("payroll.errors.cannotReopen");
      // A bank file still waiting for release is withdrawn with the payroll.
      if (file?.status === "PREVIEW") {
        await tx.fileRecord.update({ where: { id: file.id }, data: { status: "REJECTED" } });
        await tx.approvalTask.updateMany({ where: { entityType: "FileRecord", entityId: file.id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date() } });
      }
    }
    await tx.payrollRun.update({
      where: { id: runId },
      data: { status: "DRAFT", reopenedAt: new Date(), reopenNote: note, approvedById: null, approvedByName: null, approvedAt: null, submittedAt: null, checkedById: null, checkedByName: null, bankFileId: null },
    });
    await audit(tx, actor, { action: "REOPEN", entityType: "PayrollRun", entityId: runId, summary: `Reopened ${runTitle(run.payGroup as RunGroup, run.month)}: ${note}` });
    await emit(tx, actor.boardId, "payroll.reopened", { type: "PayrollRun", id: runId }, { note });
  });
}


/** One person's pay sheet in a run: every line, the days and the totals. */
export async function getPayslip(actor: Actor, runId: string, slipId: string) {
  assertView(actor);
  const slip = await db.payslip.findFirst({
    where: { id: slipId, runId, boardId: actor.boardId },
    include: {
      run: true,
      employee: { select: { employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, type: true, post: { select: { name: true, nameHi: true } }, section: { select: { name: true, nameHi: true } } } },
    },
  });
  if (!slip) throw notFound();
  const lines = slip.lines as unknown as PayLine[];
  return {
    id: slip.id,
    run: { id: slip.run.id, month: slip.run.month, payGroup: slip.run.payGroup as RunGroup, status: slip.run.status },
    employee: { ...slip.employee, name: fullName(slip.employee) },
    payLevel: slip.payLevel,
    payCell: slip.payCell,
    status: slip.status,
    withheldReason: slip.withheldReason,
    daysInMonth: slip.daysInMonth,
    daysOnRoll: num(slip.daysOnRoll),
    lossDays: num(slip.lossDays),
    halfPayDays: num(slip.halfPayDays),
    workedDays: slip.workedDays === null ? null : num(slip.workedDays),
    earnings: lines.filter((l) => l.kind === "EARNING"),
    deductions: lines.filter((l) => l.kind === "DEDUCTION"),
    employer: lines.filter((l) => l.kind === "EMPLOYER"),
    gross: num(slip.gross),
    totalDeductions: num(slip.deductions),
    net: num(slip.net),
    lastNet: slip.lastNet === null ? null : num(slip.lastNet),
    changePct: slip.changePct === null ? null : num(slip.changePct),
    bankLast4: slip.bankLast4,
    creditStatus: slip.creditStatus,
    creditNote: slip.creditNote,
  };
}
