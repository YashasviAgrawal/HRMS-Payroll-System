import "server-only";
import type { Permission } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { todayIST, toISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden } from "@/lib/errors";
import { fromPaise, toPaise } from "@/lib/money";
import { ratesOn } from "@/modules/payroll/compute";
import { additionalPensionPct } from "@/modules/pension/rules";
import { asOnMonth, buildTarget, mappingOf } from "./build";
import { loadState } from "./loads";
import { assertOpen, canSeeMigration, stagedTables } from "./staging";
import { TARGET_DEFS, TARGETS, type Options, type TargetKey } from "./targets";

/**
 * §15 checks table — each with its rule worked out from the data, and signed by the people the PRD names. A check can
 * be signed only while it passes; the cut-over needs every check passing and signed.
 */
export const CHECKS = ["RECORD_COUNTS", "MONEY_TOTALS", "GPF", "PENSION", "DUPLICATES", "EXCEPTIONS"] as const;
export type CheckCode = (typeof CHECKS)[number];
export const SIGNERS: Record<CheckCode, Permission[]> = {
  RECORD_COUNTS: ["CHECKER"],
  MONEY_TOTALS: ["PAYROLL", "APPROVER"],
  GPF: ["PAYROLL"],
  PENSION: ["PENSION"],
  DUPLICATES: ["APPROVER"],
  EXCEPTIONS: ["APPROVER"],
};

export interface CheckRow {
  label: string;
  cells: (string | number | null)[];
  ok: boolean;
}
export interface CheckResult {
  code: CheckCode;
  pass: boolean;
  /** Why it does not pass yet, as a message key with values. */
  reason?: { key: string; vars?: Record<string, string | number> };
  columns: string[];
  rows: CheckRow[];
}

const within = (a: number, b: number) => Math.abs(toPaise(a) - toPaise(b)) <= 100;

async function recordCounts(boardId: string): Promise<CheckResult> {
  const tables = await stagedTables(boardId);
  const rows = tables.map((t) => ({ label: t.tableName ?? t.fileName, cells: [t.sourceCount ?? 0, t.liveCount + t.deletedCount, t.liveCount, t.deletedCount], ok: (t.sourceCount ?? 0) === t.liveCount + t.deletedCount }));
  return { code: "RECORD_COUNTS", pass: rows.length > 0 && rows.every((r) => r.ok), reason: rows.length ? undefined : { key: "migration.checks.noTables" }, columns: ["foxpro", "staged", "live", "deleted"], rows };
}

async function moneyTotals(actor: Actor): Promise<CheckResult> {
  const built = await buildTarget(actor, "payTotals");
  const control = ((built.mapping?.options ?? {}) as unknown as Options).control ?? {};
  const by = new Map<string, { gross: number; deductions: number; net: number }>();
  for (const r of built.all) {
    const m = r.values.month;
    if (!m) continue;
    const t = by.get(m) ?? { gross: 0, deductions: 0, net: 0 };
    t.gross = fromPaise(toPaise(t.gross) + toPaise(Number(r.values.gross ?? 0)));
    t.deductions = fromPaise(toPaise(t.deductions) + toPaise(Number(r.values.deductions ?? 0)));
    t.net = fromPaise(toPaise(t.net) + toPaise(Number(r.values.net ?? 0)));
    by.set(m, t);
  }
  // The last 12 months in the old system's pay data, each against FoxPro's own printed figures.
  const months = [...by.keys()].sort().slice(-12);
  const rows = months.map((m) => {
    const s = by.get(m)!;
    const c = control[m];
    return { label: m, cells: [s.gross, c?.gross ?? null, s.deductions, c?.deductions ?? null, s.net, c?.net ?? null], ok: Boolean(c) && within(s.gross, c.gross) && within(s.deductions, c.deductions) && within(s.net, c.net) };
  });
  const reason = !built.mapping?.fileId ? { key: "migration.checks.notMapped" } : !months.length ? { key: "migration.checks.noMonths" } : rows.some((r) => r.cells[1] === null) ? { key: "migration.checks.enterControl" } : months.length < 12 ? { key: "migration.checks.fewMonths", vars: { n: months.length } } : undefined;
  return { code: "MONEY_TOTALS", pass: months.length > 0 && rows.every((r) => r.ok) && !(reason && reason.key !== "migration.checks.fewMonths"), reason, columns: ["grossStaged", "grossFoxpro", "dedStaged", "dedFoxpro", "netStaged", "netFoxpro"], rows };
}

async function gpfBalances(actor: Actor): Promise<CheckResult> {
  const built = await buildTarget(actor, "gpf");
  const asOn = ((built.mapping?.options ?? {}) as unknown as Options).asOn;
  if (!built.mapping?.fileId || !asOn) return { code: "GPF", pass: false, reason: { key: "migration.checks.notMapped" }, columns: [], rows: [] };
  const month = asOnMonth(asOn);
  const codes = built.all.map((r) => r.values.employeeCode?.toUpperCase()).filter((x): x is string => Boolean(x));
  const staff = await db.employee.findMany({ where: { boardId: actor.boardId, employeeCode: { in: codes } }, select: { id: true, employeeCode: true } });
  const idOf = new Map(staff.map((s) => [s.employeeCode!.toUpperCase(), s.id]));
  const sums = await db.gpfEntry.groupBy({ by: ["employeeId"], where: { employeeId: { in: staff.map((s) => s.id) }, month: { lte: month } }, _sum: { amount: true } });
  const ledger = new Map(sums.map((s) => [s.employeeId, Number(s._sum.amount ?? 0)]));
  const rows = built.all.map((r) => {
    const id = idOf.get((r.values.employeeCode ?? "").toUpperCase());
    const fox = Number(r.values.balance ?? 0);
    const here = id !== undefined && ledger.has(id) ? ledger.get(id)! : null;
    return { label: r.who, cells: [fox, here], ok: here !== null && within(fox, here) };
  });
  return { code: "GPF", pass: rows.length > 0 && rows.every((r) => r.ok), reason: rows.some((r) => r.cells[1] === null) ? { key: "migration.checks.notLoaded" } : undefined, columns: ["foxpro", "ledger"], rows };
}

async function pensions(actor: Actor): Promise<CheckResult> {
  const built = await buildTarget(actor, "pensioners");
  const map = (built.mapping?.fields ?? {}) as Record<string, { column: string | null } | undefined>;
  if (!built.mapping?.fileId) return { code: "PENSION", pass: false, reason: { key: "migration.checks.notMapped" }, columns: [], rows: [] };
  if (!map.lastBasicPaid?.column || !map.lastDrPaid?.column) return { code: "PENSION", pass: false, reason: { key: "migration.checks.mapLastPaid" }, columns: [], rows: [] };
  const month = todayIST().slice(0, 7);
  const rates = await ratesOn(actor.boardId, `${month}-01`, db);
  const ppos = built.all.map((r) => r.values.ppoNumber?.toUpperCase()).filter((x): x is string => Boolean(x));
  const loaded = new Map((await db.pensioner.findMany({ where: { boardId: actor.boardId, ppoNumber: { in: ppos } }, select: { ppoNumber: true, basicPension: true, payeeDob: true } })).map((p) => [p.ppoNumber, p]));
  const rows = built.all.map((r) => {
    const p = loaded.get((r.values.ppoNumber ?? "").toUpperCase());
    const basic = p ? Number(p.basicPension) : null;
    // DR on basic pension and the additional pension of the payee's age, at the DA rate in force (PN-02, PN-04).
    const dr = p ? Math.round((Number(p.basicPension) * (1 + additionalPensionPct(toISODate(p.payeeDob), month, rates) / 100) * (rates.DA_PERCENT ?? 0)) / 100) : null;
    const foxBasic = Number(r.values.lastBasicPaid ?? 0);
    const foxDr = Number(r.values.lastDrPaid ?? 0);
    return { label: r.who, cells: [foxBasic, basic, foxDr, dr], ok: basic !== null && dr !== null && within(foxBasic, basic) && within(foxDr, dr) };
  });
  return { code: "PENSION", pass: rows.length > 0 && rows.every((r) => r.ok), reason: rows.some((r) => r.cells[1] === null) ? { key: "migration.checks.notLoaded" } : undefined, columns: ["basicFoxpro", "basicHere", "drFoxpro", "drHere"], rows };
}

async function duplicates(boardId: string): Promise<CheckResult> {
  const staff = await db.employee.findMany({ where: { boardId, status: { in: ["DRAFT", "ACTIVE", "SUSPENDED"] } }, select: { panHash: true, aadhaarHash: true, bankAccountHash: true } });
  const dup = (vals: (string | null)[]) => {
    const seen = new Map<string, number>();
    for (const v of vals) if (v) seen.set(v, (seen.get(v) ?? 0) + 1);
    return [...seen.values()].filter((c) => c > 1).length;
  };
  const rows = [
    { label: "aadhaar", cells: [dup(staff.map((s) => s.aadhaarHash))], ok: false },
    { label: "pan", cells: [dup(staff.map((s) => s.panHash))], ok: false },
    { label: "bank", cells: [dup(staff.map((s) => s.bankAccountHash))], ok: false },
  ].map((r) => ({ ...r, ok: r.cells[0] === 0 }));
  return { code: "DUPLICATES", pass: staff.length > 0 && rows.every((r) => r.ok), reason: staff.length ? undefined : { key: "migration.checks.noStaff" }, columns: ["groups"], rows };
}

async function exceptions(actor: Actor): Promise<CheckResult> {
  const rows: CheckRow[] = [];
  for (const target of TARGETS.filter((t) => TARGET_DEFS[t].loads)) {
    const m = await mappingOf(actor.boardId, target);
    if (!m?.fileId) continue;
    const built = await buildTarget(actor, target);
    const explained = built.issues.filter((i) => i.note).length;
    const waiting = built.ready.length;
    const pending = await loadState(actor.boardId, target);
    rows.push({ label: target, cells: [built.issues.length, explained, built.open, built.loaded, waiting], ok: built.open === 0 && waiting === 0 && !pending });
  }
  return { code: "EXCEPTIONS", pass: rows.length > 0 && rows.every((r) => r.ok), reason: rows.length ? undefined : { key: "migration.checks.notMapped" }, columns: ["flagged", "explained", "open", "loaded", "toLoad"], rows };
}

export async function runCheck(actor: Actor, code: CheckCode): Promise<CheckResult> {
  switch (code) {
    case "RECORD_COUNTS":
      return recordCounts(actor.boardId);
    case "MONEY_TOTALS":
      return moneyTotals(actor);
    case "GPF":
      return gpfBalances(actor);
    case "PENSION":
      return pensions(actor);
    case "DUPLICATES":
      return duplicates(actor.boardId);
    case "EXCEPTIONS":
      return exceptions(actor);
  }
}

/** S-90 checks tab: every check with its figures, who signed it and whether this login may sign now. */
export async function checksScreen(actor: Actor) {
  if (!canSeeMigration(actor)) throw forbidden();
  const signoffs = await db.migrationSignoff.findMany({ where: { boardId: actor.boardId } });
  const out = [];
  for (const code of CHECKS) {
    const result = await runCheck(actor, code);
    const signed = signoffs.filter((s) => s.check === code).map((s) => ({ permission: s.permission, name: s.userName, at: s.createdAt.toISOString() }));
    const mine = SIGNERS[code].find((p) => actor.permissions.includes(p) && !signed.some((s) => s.permission === p));
    out.push({ ...result, signers: SIGNERS[code], signed, canSign: result.pass && mine ? mine : null, done: SIGNERS[code].every((p) => signed.some((s) => s.permission === p)) });
  }
  return { checks: out };
}

/** One signature on a passing check, with the figures it was given on. */
export async function signCheck(actor: Actor, raw: string) {
  if (!(CHECKS as readonly string[]).includes(raw)) throw badRequest();
  const code = raw as CheckCode;
  await assertOpen(actor);
  const permission = SIGNERS[code].find((p) => actor.permissions.includes(p));
  if (!permission || !canSeeMigration(actor)) throw forbidden();
  const result = await runCheck(actor, code);
  if (!result.pass) throw conflict("migration.errors.checkFails");
  return db.$transaction(async (tx) => {
    const existing = await tx.migrationSignoff.findUnique({ where: { boardId_check_permission: { boardId: actor.boardId, check: code, permission } } });
    if (existing) throw conflict("migration.errors.alreadySigned");
    const row = await tx.migrationSignoff.create({ data: { boardId: actor.boardId, check: code, permission, userId: actor.userId, userName: actor.name, result: JSON.parse(JSON.stringify(result)) } });
    await audit(tx, actor, { action: "APPROVE", entityType: "MigrationCheck", entityId: code, summary: `Signed the migration check "${code}" as ${permission}` });
    return row;
  });
}

export type ChecksScreen = Awaited<ReturnType<typeof checksScreen>>;
export const targetsWithLoads = TARGETS.filter((t): t is TargetKey => TARGET_DEFS[t].loads);
