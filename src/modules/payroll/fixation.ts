import "server-only";
import { z } from "zod";
import type { ApprovalTask } from "@/generated/prisma/client";
import { submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/session";
import { db, type Tx } from "@/lib/db";
import { formatDate, fromISODate, todayIST, toISODate, type ISODate } from "@/lib/dates";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { formatINR } from "@/lib/money";
import { emit } from "@/lib/outbox";
import { isoDateField } from "@/lib/validators";
import { fullName } from "@/modules/employees/present";
import { applyDuePayChanges, matrixOn, payAsOf } from "./compute";
import { canPreparePay } from "./increments";
import { fixPay, incrementMonthFor, type Fixation } from "./pay-rules";

/**
 * PR-07, S-41: pay fixation on promotion or MACP, with the rule used shown on screen. HR & Accounts prepare it; a
 * Checker checks it and an Admin approves it (a promotion is one of the service book events that need an Approver, §14).
 * On approval the new pay goes into the pay history from its dates, the post changes on promotion, and the service book
 * records the order.
 */
export const fixationSchema = z
  .object({
    employeeId: z.string().min(1),
    kind: z.enum(["PROMOTION", "MACP"]),
    toLevel: z.string().min(1).max(4),
    toPostId: z.string().optional(),
    effectiveFrom: isoDateField,
    option: z.enum(["FROM_PROMOTION", "FROM_NEXT_INCREMENT"]),
    orderNumber: z.string().trim().min(3, "validation.tooShort").max(80),
    orderDate: isoDateField.optional(),
  })
  .refine((v) => v.kind === "MACP" || Boolean(v.toPostId), { message: "validation.required", path: ["toPostId"] });

export type FixationInput = z.infer<typeof fixationSchema>;

async function work(actor: Actor, raw: unknown) {
  if (!canPreparePay(actor)) throw forbidden();
  const input = fixationSchema.parse(raw);
  const e = await db.employee.findFirst({ where: { id: input.employeeId, boardId: actor.boardId, status: "ACTIVE" }, include: { post: true, payHistory: { orderBy: { effectiveFrom: "desc" } } } });
  if (!e) throw notFound();
  if (e.id === actor.employeeId) throw forbidden("errors.ownPay");
  const pay = (await payAsOf(db, [e], input.effectiveFrom)).get(e.id)!;
  const matrix = await matrixOn(actor.boardId, input.effectiveFrom, db);
  if (!matrix || !pay.payLevel || !pay.payCell) throw badRequest("payroll.fixation.noPay");
  const levels = matrix.levels as Record<string, number[]>;
  if (!levels[input.toLevel]) throw badRequest("errors.validation", { toLevel: "validation.invalid" });
  if (Number.parseInt(input.toLevel, 10) < Number.parseInt(pay.payLevel, 10)) throw badRequest("errors.validation", { toLevel: "payroll.fixation.lowerLevel" });
  const lastFix = e.payHistory.find((h) => h.reason === "PROMOTION" || h.reason === "MACP" || h.reason === "INITIAL");
  const incrementMonth = (e.incrementMonth ?? incrementMonthFor(lastFix ? toISODate(lastFix.effectiveFrom) : toISODate(e.dateOfJoining))) as 1 | 7;
  const fixation = fixPay(levels, { fromLevel: pay.payLevel, fromCell: pay.payCell, toLevel: input.toLevel, date: input.effectiveFrom, option: input.option, incrementMonth });
  if (!fixation) throw badRequest("payroll.fixation.noPay");
  const toPost = input.toPostId ? await db.post.findFirst({ where: { id: input.toPostId, boardId: actor.boardId } }) : null;
  if (input.kind === "PROMOTION" && !toPost) throw badRequest("errors.validation", { toPostId: "validation.invalid" });
  const currentPost = await db.post.findUniqueOrThrow({ where: { id: pay.postId } });
  return { input, employee: e, current: { level: pay.payLevel, cell: pay.payCell, basic: levels[pay.payLevel][pay.payCell - 1], post: currentPost }, fixation, toPost, incrementMonth };
}

/** What the fixation comes to, before anything is sent — the screen shows the rule and every figure. */
export async function previewFixation(actor: Actor, raw: unknown) {
  const w = await work(actor, raw);
  return {
    employee: { id: w.employee.id, code: w.employee.employeeCode, name: fullName(w.employee), nameHi: w.employee.nameHi },
    current: { level: w.current.level, cell: w.current.cell, basic: w.current.basic, post: w.current.post.name, postHi: w.current.post.nameHi },
    toPost: w.toPost ? { name: w.toPost.name, nameHi: w.toPost.nameHi } : null,
    fixation: w.fixation,
    oldIncrementMonth: w.incrementMonth,
  };
}

function describe(f: Fixation, lang: "en" | "hi" = "en") {
  return f.steps
    .map((s) =>
      lang === "hi"
        ? `${formatDate(s.date, "hi")} से लेवल ${s.level}, सेल ${s.cell} (${formatINR(s.basic)})`
        : `From ${formatDate(s.date)}: Level ${s.level}, cell ${s.cell} (${formatINR(s.basic)})`,
    )
    .join("; ");
}

export async function submitFixation(actor: Actor, raw: unknown) {
  const w = await work(actor, raw);
  const { input, employee: e, fixation } = w;
  return db.$transaction(async (tx) => {
    const task = await submitForApproval(tx, actor, {
      kind: "pay.fixation",
      title: `${input.kind === "PROMOTION" ? "Promotion" : "MACP"} pay fixation: ${fullName(e)} (${e.employeeCode}) to Level ${input.toLevel}`,
      titleHi: `${input.kind === "PROMOTION" ? "पदोन्नति" : "एमएसीपी"} वेतन निर्धारण: ${e.nameHi ?? fullName(e)} (${e.employeeCode}) — लेवल ${input.toLevel}`,
      details: {
        summary: `Rule: ${input.option === "FROM_PROMOTION" ? "one increment in the old level, then the equal or next higher cell in the new level (from the promotion date)" : "equal or next higher cell on promotion; re-fixed on the next increment date with two increments in the old level"}. After the Checker, an Admin approves.`,
        summaryHi: `नियम: ${input.option === "FROM_PROMOTION" ? "पुराने लेवल में एक वेतन वृद्धि, फिर नए लेवल में बराबर या अगला ऊँचा सेल (पदोन्नति तिथि से)" : "पदोन्नति पर बराबर या अगला ऊँचा सेल; अगली वेतन वृद्धि तिथि पर पुराने लेवल में दो वेतन वृद्धि देकर फिर से निर्धारण"}। जाँचकर्ता के बाद एडमिन स्वीकृत करते हैं।`,
        link: `/payroll/increments?tab=fixation`,
        rows: [
          { label: "Now", labelHi: "अभी", new: `Level ${w.current.level}, cell ${w.current.cell} (${formatINR(w.current.basic)}) · ${w.current.post.name}` },
          ...fixation.steps.map((s) => ({ label: `From ${formatDate(s.date)}`, labelHi: `${formatDate(s.date, "hi")} से`, old: `Notional ${formatINR(s.from.notional)} in Level ${s.from.level}`, new: `Level ${s.level}, cell ${s.cell} (${formatINR(s.basic)})` })),
          ...(w.toPost ? [{ label: "New post", labelHi: "नया पद", old: w.current.post.name, new: w.toPost.name }] : []),
          { label: "Increment month", labelHi: "वेतन वृद्धि माह", old: w.incrementMonth === 1 ? "January" : "July", new: fixation.incrementMonth === 1 ? "January" : "July" },
          { label: "Order", labelHi: "आदेश", new: [input.orderNumber, input.orderDate ? formatDate(input.orderDate) : null].filter(Boolean).join(" dated ") },
        ],
      } satisfies ApprovalDetails,
      payload: { input, fixation, oldPostId: w.current.post.id },
      entityType: "PayFixation",
      entityId: e.id,
      subjectEmployeeId: e.id,
    });
    await audit(tx, actor, { action: "SUBMIT", entityType: "PayFixation", entityId: e.id, summary: `Pay fixation sent for checking: ${fullName(e)} — ${describe(fixation)}`, sensitive: true });
    return task;
  });
}

export interface FixationPayload {
  input: FixationInput;
  fixation: Fixation;
  oldPostId: string;
}

export async function applyFixation(tx: Tx, task: ApprovalTask, actor: Actor, p: FixationPayload) {
  const { input, fixation } = p;
  const entry = await tx.serviceBookEntry.create({
    data: {
      employeeId: input.employeeId,
      event: input.kind,
      eventDate: fromISODate(input.effectiveFrom),
      orderNumber: input.orderNumber,
      orderDate: input.orderDate ? fromISODate(input.orderDate) : null,
      details: `${input.kind === "PROMOTION" ? "Promotion" : "MACP"} — pay fixed: ${describe(fixation)}`,
      detailsHi: `${input.kind === "PROMOTION" ? "पदोन्नति" : "एमएसीपी"} — वेतन निर्धारण: ${describe(fixation, "hi")}`,
      data: JSON.parse(JSON.stringify({ option: fixation.option, steps: fixation.steps, incrementMonth: fixation.incrementMonth })),
      status: "APPROVED",
      createdById: task.makerId,
      approvedById: actor.userId,
    },
  });
  for (const [i, s] of fixation.steps.entries()) {
    await tx.payHistory.create({
      data: {
        boardId: task.boardId,
        employeeId: input.employeeId,
        effectiveFrom: fromISODate(s.date as ISODate),
        payLevel: s.level,
        payCell: s.cell,
        postId: input.toPostId ?? null,
        reason: input.kind,
        details: i === 0 ? JSON.parse(JSON.stringify({ option: fixation.option, steps: fixation.steps })) : undefined,
        serviceEntryId: entry.id,
        createdById: task.makerId,
      },
    });
  }
  await tx.employee.update({ where: { id: input.employeeId }, data: { incrementMonth: fixation.incrementMonth } });
  await applyDuePayChanges(tx, task.boardId, todayIST());
  await emit(tx, task.boardId, "pay.fixed", { type: "Employee", id: input.employeeId }, { kind: input.kind, steps: fixation.steps.length });
}
