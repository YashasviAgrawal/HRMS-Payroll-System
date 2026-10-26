import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { pendingFor, submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { can, canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db, type Tx } from "@/lib/db";
import { shiftMonth, todayIST } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { formatINR } from "@/lib/money";
import { emit } from "@/lib/outbox";
import { dueRules } from "./calendar-service";
import { fyOfMonth, type Regime, type TaxRuleSet } from "./tax-rules";
import { taxRulesFor } from "./tds-projection";

/**
 * ST-01, S-81: income-tax slabs (by year and regime) and the statutory due dates are editable tables. HR & Accounts
 * propose a change with the order or Finance Act behind it; an Admin approves (§14 rates and rules).
 */
const canSee = (actor: Actor) => can(actor, "rates_rules", "view") || can(actor, "payroll", "view");
const canPropose = (actor: Actor) => canAll(actor, "rates_rules", "create");
const rupees = z.coerce.number().min(0, "validation.invalid").max(100_000_000, "validation.invalid");

export const taxRuleSchema = z
  .object({
    fy: z.string().regex(/^\d{4}-\d{2}$/),
    regime: z.enum(["NEW", "OLD"]),
    slabs: z.array(z.object({ upTo: rupees.nullable(), rate: z.coerce.number().min(0).max(50) })).min(1).max(10),
    standardDeduction: rupees,
    rebateIncomeLimit: rupees,
    rebateMax: rupees,
    cessPercent: z.coerce.number().min(0).max(10),
    reason: z.string().trim().min(5, "validation.tooShort").max(200),
  })
  .refine((v) => v.slabs.at(-1)!.upTo === null && v.slabs.slice(0, -1).every((s, i, a) => s.upTo !== null && (i === 0 || s.upTo > a[i - 1].upTo!)), { path: ["slabs"], message: "statutory.rules.slabOrder" });

export const dueRuleSchema = z.object({
  code: z.string().min(1).max(30),
  day: z.coerce.number().int().min(0).max(31),
  dates: z.array(z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "statutory.rules.dateFormat")).max(4),
  reason: z.string().trim().min(5, "validation.tooShort").max(200),
});

/** The years shown: last year, this year, and next year from February (so a Budget's slabs can be set up early). */
function yearsShown(today = todayIST()) {
  const fy = fyOfMonth(today.slice(0, 7));
  const prev = fyOfMonth(shiftMonth(`${fy.slice(0, 4)}-04`, -1));
  const next = fyOfMonth(shiftMonth(`${fy.slice(0, 4)}-04`, 12));
  const m = Number(today.slice(5, 7));
  return m >= 2 && m <= 3 ? [next, fy, prev] : [fy, prev];
}

export async function taxRulesScreen(actor: Actor) {
  if (!canSee(actor)) throw forbidden();
  const years = yearsShown();
  const [sets, stored, pending] = await Promise.all([
    Promise.all(years.map((y) => taxRulesFor(db, actor.boardId, y))),
    db.taxRule.findMany({ where: { boardId: actor.boardId, fy: { in: years } }, select: { fy: true, regime: true, version: true, updatedAt: true } }),
    db.approvalTask.findMany({ where: { boardId: actor.boardId, status: "PENDING", kind: "tax.rule" }, select: { entityId: true } }),
  ]);
  const waiting = new Set(pending.map((p) => p.entityId));
  return {
    years: years.map((fy, i) => ({
      fy,
      regimes: (["NEW", "OLD"] as Regime[]).map((regime) => {
        const row = stored.find((s) => s.fy === fy && s.regime === regime);
        return { regime, rules: sets[i][regime], saved: Boolean(row), version: row?.version ?? 0, waiting: waiting.has(`${fy}|${regime}`) };
      }),
    })),
    canPropose: canPropose(actor),
  };
}

const slabText = (s: TaxRuleSet["slabs"]) => s.map((x, i) => `${i === 0 ? "0" : formatINR(s[i - 1].upTo!)}–${x.upTo === null ? "above" : formatINR(x.upTo)}: ${x.rate}%`).join("; ");

export async function proposeTaxRule(actor: Actor, raw: unknown) {
  if (!canPropose(actor)) throw forbidden();
  const input = taxRuleSchema.parse(raw);
  if (!yearsShown().includes(input.fy)) throw badRequest("errors.validation", { fy: "validation.invalid" });
  const current = (await taxRulesFor(db, actor.boardId, input.fy))[input.regime];
  return db.$transaction(async (tx) => {
    if ((await pendingFor(actor.boardId, "TaxRule", `${input.fy}|${input.regime}`, ["tax.rule"], tx)).length) throw conflict("payroll.errors.ratePending");
    const regime = input.regime === "NEW" ? "new regime" : "old regime";
    return submitForApproval(tx, actor, {
      kind: "tax.rule",
      title: `Income tax ${input.fy} — ${regime}: slabs and limits`,
      titleHi: `आयकर ${input.fy} — ${input.regime === "NEW" ? "नई व्यवस्था" : "पुरानी व्यवस्था"}: स्लैब और सीमाएँ`,
      details: {
        summary: "Used for every TDS projection and Form 16 of the year from the next payroll run.",
        summaryHi: "अगले वेतन रन से वर्ष के हर टीडीएस अनुमान और फ़ॉर्म 16 में लागू।",
        link: "/admin/rates?tab=tax",
        rows: [
          { label: "Slabs", labelHi: "स्लैब", old: slabText(current.slabs), new: slabText(input.slabs) },
          { label: "Standard deduction", labelHi: "मानक कटौती", old: formatINR(current.standardDeduction), new: formatINR(input.standardDeduction) },
          { label: "Rebate u/s 87A", labelHi: "धारा 87ए छूट", old: `${formatINR(current.rebateMax)} up to ${formatINR(current.rebateIncomeLimit)}`, new: `${formatINR(input.rebateMax)} up to ${formatINR(input.rebateIncomeLimit)}` },
          { label: "Cess", labelHi: "उपकर", old: `${current.cessPercent}%`, new: `${input.cessPercent}%` },
          { label: "Order / reason", labelHi: "आदेश / कारण", new: input.reason },
        ],
      } satisfies ApprovalDetails,
      payload: input,
      entityType: "TaxRule",
      entityId: `${input.fy}|${input.regime}`,
      note: input.reason,
    });
  });
}

export async function applyTaxRule(tx: Tx, boardId: string, p: z.infer<typeof taxRuleSchema>) {
  const data = { slabs: p.slabs as unknown as Prisma.InputJsonValue, standardDeduction: p.standardDeduction, rebateIncomeLimit: p.rebateIncomeLimit, rebateMax: p.rebateMax, cessPercent: p.cessPercent };
  const row = await tx.taxRule.upsert({ where: { boardId_fy_regime: { boardId, fy: p.fy, regime: p.regime } }, create: { boardId, fy: p.fy, regime: p.regime, ...data }, update: { ...data, version: { increment: 1 } } });
  await emit(tx, boardId, "tax.rule.changed", { type: "TaxRule", id: row.id }, { fy: p.fy, regime: p.regime });
}

export async function dueRulesScreen(actor: Actor) {
  if (!canSee(actor)) throw forbidden();
  const [rules, pending] = await Promise.all([dueRules(actor.boardId), db.approvalTask.findMany({ where: { boardId: actor.boardId, status: "PENDING", kind: "due.rule" }, select: { entityId: true } })]);
  const waiting = new Set(pending.map((p) => p.entityId));
  return { rules: rules.map((r) => ({ ...r, waiting: waiting.has(r.code) })), canPropose: canPropose(actor) };
}

const whenText = (r: { kind: string; day: number; dates: string[] }) =>
  r.kind === "MONTHLY" ? `Day ${r.day} of the next month` : r.kind === "AFTER_PAY" ? `${r.day} days after the pay bill` : r.dates.join(", ");

export async function proposeDueRule(actor: Actor, raw: unknown) {
  if (!canPropose(actor)) throw forbidden();
  const input = dueRuleSchema.parse(raw);
  const rule = (await dueRules(actor.boardId)).find((r) => r.code === input.code);
  if (!rule) throw notFound();
  const periodic = rule.kind === "MONTHLY" || rule.kind === "AFTER_PAY";
  if (periodic && (input.day < 1 || input.day > (rule.kind === "MONTHLY" ? 28 : 30))) throw badRequest("errors.validation", { day: "validation.invalid" });
  if (!periodic && input.dates.length !== rule.dates.length) throw badRequest("errors.validation", { dates: "statutory.rules.dateCount" });
  const next = { kind: rule.kind, day: periodic ? input.day : 0, dates: periodic ? [] : input.dates };
  return db.$transaction(async (tx) => {
    if ((await pendingFor(actor.boardId, "DueRule", rule.code, ["due.rule"], tx)).length) throw conflict("payroll.errors.ratePending");
    return submitForApproval(tx, actor, {
      kind: "due.rule",
      title: `Due date: ${rule.name}`,
      titleHi: `देय तिथि: ${rule.nameHi}`,
      details: {
        link: "/admin/rates?tab=dues",
        rows: [
          { label: rule.name, labelHi: rule.nameHi, old: whenText(rule), new: whenText(next) },
          { label: "Order / reason", labelHi: "आदेश / कारण", new: input.reason },
        ],
      } satisfies ApprovalDetails,
      payload: { ...input, ...next },
      entityType: "DueRule",
      entityId: rule.code,
      note: input.reason,
    });
  });
}

export async function applyDueRule(tx: Tx, boardId: string, p: z.infer<typeof dueRuleSchema> & { kind: string }) {
  const def = (await dueRules(boardId)).find((r) => r.code === p.code);
  if (!def) throw notFound();
  await tx.dueRule.upsert({
    where: { boardId_code: { boardId, code: p.code } },
    create: { boardId, code: def.code, name: def.name, nameHi: def.nameHi, kind: def.kind, day: p.day, dates: p.dates },
    update: { day: p.day, dates: p.dates, version: { increment: 1 } },
  });
}
