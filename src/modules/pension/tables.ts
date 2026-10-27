import "server-only";
import { z } from "zod";
import type { ApprovalTask, Prisma } from "@/generated/prisma/client";
import { submitForApproval } from "@/lib/approvals/engine";
import { audit } from "@/lib/audit";
import { can, canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db, type Tx } from "@/lib/db";
import { formatDate, fromISODate, todayIST, toISODate } from "@/lib/dates";
import { conflict, forbidden } from "@/lib/errors";
import { emit } from "@/lib/outbox";
import { isoDateField } from "@/lib/validators";

/**
 * PN-08 / PRD §10: the commutation factor table is an editable dated table (central-rule default from 2008). A new
 * table is proposed by HR & Accounts and takes effect from its date once an Admin approves (S-81 Pension tables).
 */
const CODE = "COMMUTATION_FACTORS";

export async function commutationTables(actor: Actor) {
  if (!canAll(actor, "rates_rules", "view") && !canAll(actor, "pension", "view")) throw forbidden();
  const [tables, pending] = await Promise.all([
    db.ruleTable.findMany({ where: { boardId: actor.boardId, code: CODE }, orderBy: { effectiveFrom: "desc" } }),
    db.approvalTask.findMany({ where: { boardId: actor.boardId, kind: "pension.table", status: "PENDING" }, select: { id: true, title: true, makerName: true, createdAt: true } }),
  ]);
  const today = todayIST();
  const inForce = tables.find((t) => toISODate(t.effectiveFrom) <= today) ?? null;
  return {
    tables: tables.map((t) => ({ id: t.id, effectiveFrom: toISODate(t.effectiveFrom), note: t.note, factors: t.data as Record<string, number>, inForce: t.id === inForce?.id })),
    pending: pending.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
    canPropose: can(actor, "rates_rules", "create"),
  };
}

export const commutationTableSchema = z.object({
  effectiveFrom: isoDateField,
  factors: z.record(z.string().regex(/^\d{2}$/), z.coerce.number().min(0.5, "validation.invalid").max(20, "validation.invalid")).refine((f) => Object.keys(f).length >= 10, "validation.required"),
  reason: z.string().trim().min(5, "validation.tooShort").max(200),
});

export async function proposeCommutationTable(actor: Actor, raw: unknown) {
  if (!can(actor, "rates_rules", "create")) throw forbidden();
  const input = commutationTableSchema.parse(raw);
  return db.$transaction(async (tx) => {
    if (await tx.approvalTask.count({ where: { boardId: actor.boardId, kind: "pension.table", status: "PENDING" } })) throw conflict("pension.errors.changeWaiting");
    const ages = Object.keys(input.factors).sort();
    return submitForApproval(tx, actor, {
      kind: "pension.table",
      title: `Commutation table from ${formatDate(input.effectiveFrom)}`,
      titleHi: `${formatDate(input.effectiveFrom, "hi")} से रूपांतरण तालिका`,
      details: {
        summary: input.reason,
        rows: ages.filter((a) => Number(a) >= 55 && Number(a) <= 70).map((a) => ({ label: `Age next birthday ${a}`, labelHi: `अगले जन्मदिन पर आयु ${a}`, new: String(input.factors[a]) })),
        link: "/admin/rates?tab=pension",
      },
      payload: input,
      entityType: "RuleTable",
      entityId: CODE,
      note: input.reason,
    });
  });
}

export async function applyCommutationTable(tx: Tx, task: ApprovalTask, actor: Actor, p: z.infer<typeof commutationTableSchema>) {
  const row = await tx.ruleTable.upsert({
    where: { boardId_code_effectiveFrom: { boardId: actor.boardId, code: CODE, effectiveFrom: fromISODate(p.effectiveFrom) } },
    create: { boardId: actor.boardId, code: CODE, effectiveFrom: fromISODate(p.effectiveFrom), data: p.factors as unknown as Prisma.InputJsonValue, note: p.reason, createdById: task.makerId },
    update: { data: p.factors as unknown as Prisma.InputJsonValue, note: p.reason },
  });
  await audit(tx, actor, { action: "UPDATE", entityType: "RuleTable", entityId: row.id, summary: `Commutation table from ${formatDate(p.effectiveFrom)} approved` });
  await emit(tx, actor.boardId, "pension.table_changed", { type: "RuleTable", id: row.id }, { code: CODE, effectiveFrom: p.effectiveFrom });
}
