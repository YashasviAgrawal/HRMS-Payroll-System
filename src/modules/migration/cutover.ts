import "server-only";
import { z } from "zod";
import type { ApprovalTask } from "@/generated/prisma/client";
import { submitForApproval } from "@/lib/approvals/engine";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/session";
import { db, type Tx } from "@/lib/db";
import { formatDate, isISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden } from "@/lib/errors";
import { emit } from "@/lib/outbox";
import { checksScreen } from "./checks";
import { loadState } from "./loads";
import { parallelScreen } from "./parallel";
import { assertOpen, canSeeMigration, canWorkMigration, cutOverOf } from "./staging";
import { TARGET_DEFS, TARGETS } from "./targets";

/**
 * §15 step 10: the Admin signs the cut-over once every check is passing and signed, three parallel months in a row are
 * explained to the rupee, every record is locked and no load is waiting. FoxPro is then kept read-only for 8 years and
 * this console becomes read-only.
 */
export interface Readiness {
  key: "checks" | "parallel" | "staff" | "pensioners" | "loads";
  ok: boolean;
  vars: Record<string, string | number>;
}

export async function readiness(actor: Actor): Promise<Readiness[]> {
  const [checks, parallel, staff, pensioners] = await Promise.all([
    checksScreen(actor),
    parallelScreen(actor),
    db.employee.findMany({ where: { boardId: actor.boardId, status: { in: ["ACTIVE", "SUSPENDED"] } }, select: { verification: { select: { lockedAt: true } } } }),
    db.pensioner.findMany({ where: { boardId: actor.boardId, status: "ACTIVE" }, select: { verification: { select: { lockedAt: true } } } }),
  ]);
  const pending = (await Promise.all(TARGETS.filter((t) => TARGET_DEFS[t].loads).map((t) => loadState(actor.boardId, t)))).filter(Boolean).length;
  const done = checks.checks.filter((c) => c.pass && c.done).length;
  const lockedStaff = staff.filter((s) => s.verification?.lockedAt).length;
  const lockedPensions = pensioners.filter((p) => p.verification?.lockedAt).length;
  return [
    { key: "checks", ok: done === checks.checks.length, vars: { done, total: checks.checks.length } },
    { key: "parallel", ok: parallel.streak >= 3, vars: { streak: parallel.streak } },
    { key: "staff", ok: staff.length > 0 && lockedStaff === staff.length, vars: { locked: lockedStaff, total: staff.length } },
    { key: "pensioners", ok: lockedPensions === pensioners.length, vars: { locked: lockedPensions, total: pensioners.length } },
    { key: "loads", ok: pending === 0, vars: { pending } },
  ];
}

export async function cutOverScreen(actor: Actor) {
  if (!canSeeMigration(actor)) throw forbidden();
  const [cutOver, ready, pending] = await Promise.all([cutOverOf(actor.boardId), readiness(actor), db.approvalTask.findFirst({ where: { boardId: actor.boardId, kind: "migration.cutover", status: "PENDING" } })]);
  return { cutOver, ready, pending: pending ? { id: pending.id, date: (pending.payload as { date: string }).date, byName: pending.makerName } : null, canPropose: !cutOver && !pending && canWorkMigration(actor) && ready.every((r) => r.ok) };
}

export async function proposeCutOver(actor: Actor, raw: unknown) {
  if (!canWorkMigration(actor)) throw forbidden();
  await assertOpen(actor);
  const { date } = z.object({ date: z.string().refine(isISODate, "validation.date") }).parse(raw);
  const ready = await readiness(actor);
  if (!ready.every((r) => r.ok)) throw badRequest("migration.errors.notReady");
  return db.$transaction(async (tx) => {
    if (await tx.approvalTask.findFirst({ where: { boardId: actor.boardId, kind: "migration.cutover", status: "PENDING" } })) throw conflict("migration.errors.cutOverPending");
    const task = await submitForApproval(tx, actor, {
      kind: "migration.cutover",
      title: `Cut over from FoxPro on ${formatDate(date)}`,
      titleHi: `${formatDate(date, "hi")} को फॉक्सप्रो से नई प्रणाली पर जाएँ`,
      details: { summary: "Every §15 check is passing and signed, three parallel months are explained to the rupee, every record is locked. After approval FoxPro is kept read-only for 8 years and the migration console becomes read-only.", summaryHi: "§15 की हर जाँच सही और हस्ताक्षरित है, तीन समानांतर माह रुपये तक मिले, हर रिकॉर्ड लॉक है। स्वीकृति के बाद फॉक्सप्रो 8 वर्ष केवल पढ़ने के लिए रहेगा और माइग्रेशन कंसोल केवल देखने के लिए।", link: "/migration?tab=cutover" },
      payload: { date },
      entityType: "MigrationCutOver",
      entityId: date,
    });
    await audit(tx, actor, { action: "SUBMIT", entityType: "MigrationCutOver", entityId: task.id, summary: `Asked the Admin to sign the cut-over on ${date}` });
    return task;
  });
}

export async function applyCutOver(tx: Tx, task: ApprovalTask, actor: Actor, date: string) {
  if (await cutOverOf(task.boardId, tx)) throw conflict("migration.errors.cutOver");
  const value = { date, byName: actor.name, at: new Date().toISOString() };
  await tx.setting.upsert({ where: { boardId_key: { boardId: task.boardId, key: "migration.cutover" } }, create: { boardId: task.boardId, key: "migration.cutover", value }, update: { value } });
  await audit(tx, actor, { action: "APPROVE", entityType: "MigrationCutOver", entityId: task.id, summary: `Signed the cut-over from FoxPro on ${date}; FoxPro is now read-only` });
  await emit(tx, task.boardId, "migration.cutover", { type: "Board", id: task.boardId }, { date });
}
