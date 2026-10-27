import "server-only";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { forbidden } from "@/lib/errors";
import { buildTarget, mappingOf, type Issue } from "./build";
import { cutOverOf, canSeeMigration, canUploadMigration, canWorkMigration } from "./staging";
import { loadState } from "./loads";
import { SIGNERS, type CheckCode } from "./checks";
import { parallelScreen } from "./parallel";
import { TARGET_DEFS, TARGETS, type TargetKey } from "./targets";

/** S-90 overview: where each of the ten §15 steps stands, and what each target holds. */
export async function overviewScreen(actor: Actor) {
  if (!canSeeMigration(actor) && !canUploadMigration(actor)) throw forbidden();
  const boardId = actor.boardId;
  const [files, tables, rows, cleaned, cutOver, signoffRows, staff, staffLocked, staffConfirmed, staffBook] = await Promise.all([
    db.migrationFile.count({ where: { boardId } }),
    db.migrationFile.findMany({ where: { boardId, kind: { in: ["DBF", "CSV", "XLSX"] }, replaced: false }, select: { sourceCount: true, liveCount: true, deletedCount: true } }),
    db.migrationRow.count({ where: { file: { boardId, replaced: false } } }),
    db.migrationRow.count({ where: { file: { boardId, replaced: false }, fixedAt: { not: null } } }),
    cutOverOf(boardId),
    db.migrationSignoff.findMany({ where: { boardId }, select: { check: true, permission: true } }),
    db.employee.count({ where: { boardId, status: { in: ["ACTIVE", "SUSPENDED"] } } }),
    db.recordVerification.count({ where: { boardId, employeeId: { not: null }, lockedAt: { not: null }, employee: { status: { in: ["ACTIVE", "SUSPENDED"] } } } }),
    db.recordVerification.count({ where: { boardId, employeeId: { not: null }, confirmedAt: { not: null }, employee: { status: { in: ["ACTIVE", "SUSPENDED"] } } } }),
    db.recordVerification.count({ where: { boardId, employeeId: { not: null }, serviceBookAt: { not: null }, employee: { status: { in: ["ACTIVE", "SUSPENDED"] } } } }),
  ]);
  const targets = [];
  if (canSeeMigration(actor)) {
    for (const t of TARGETS) {
      const m = await mappingOf(boardId, t);
      if (!m?.fileId) {
        targets.push({ key: t, owner: TARGET_DEFS[t].owner, mapped: false, signed: false, records: 0, open: 0, explained: 0, loaded: 0, ready: 0, pending: null as Awaited<ReturnType<typeof loadState>> });
        continue;
      }
      const b = await buildTarget(actor, t);
      targets.push({ key: t, owner: TARGET_DEFS[t].owner, mapped: true, signed: Boolean(m.signedAt), records: b.all.length, open: b.open, explained: b.issues.filter((i) => i.note).length, loaded: b.loaded, ready: b.ready.length, pending: TARGET_DEFS[t].loads ? await loadState(boardId, t) : null });
    }
  }
  const parallel = canSeeMigration(actor) ? await parallelScreen(actor) : null;
  const staged = tables.reduce((a, t) => a + t.liveCount + t.deletedCount, 0);
  return {
    cutOver,
    steps: {
      freeze: { files },
      decode: { tables: tables.length },
      stage: { rows, staged, countsMatch: tables.length > 0 && tables.every((t) => (t.sourceCount ?? 0) === t.liveCount + t.deletedCount) },
      map: { mapped: targets.filter((t) => t.mapped).length, signed: targets.filter((t) => t.signed).length, total: TARGETS.length },
      clean: { cleaned, open: targets.reduce((a, t) => a + t.open, 0), explained: targets.reduce((a, t) => a + t.explained, 0) },
      verify: { staff, serviceBook: staffBook, confirmed: staffConfirmed, locked: staffLocked },
      // Opening balances and pensions (step 8); employees are step 4–7's.
      load: (() => {
        const balances = targets.filter((t) => TARGET_DEFS[t.key].loads && t.key !== "employees");
        const mapped = balances.filter((t) => t.mapped);
        return { loaded: balances.reduce((a, t) => a + t.loaded, 0), waiting: targets.filter((t) => t.pending).length, mapped: mapped.length, done: mapped.length > 0 && mapped.every((t) => t.loaded > 0 && t.ready === 0 && t.open === 0 && !t.pending) };
      })(),
      checks: { signed: (Object.keys(SIGNERS) as CheckCode[]).filter((c) => SIGNERS[c].every((p) => signoffRows.some((r) => r.check === c && r.permission === p))) },
      parallel: { months: parallel?.months.length ?? 0, streak: parallel?.streak ?? 0 },
    },
    targets,
    can: { work: canWorkMigration(actor), see: canSeeMigration(actor), upload: canUploadMigration(actor) },
  };
}

/** S-90 exceptions: one target's flagged rows, open first, with the cleaned value and the explanation. */
export async function issuesScreen(actor: Actor, target: TargetKey, filter: "open" | "explained" | "all" = "open") {
  if (!canSeeMigration(actor)) throw forbidden();
  const built = await buildTarget(actor, target);
  const list = built.issues.filter((i) => (filter === "open" ? !i.note : filter === "explained" ? Boolean(i.note) : true));
  // The staged value of the field, so it can be cleaned in place.
  const fields = (built.mapping?.fields ?? {}) as Record<string, { column: string | null } | undefined>;
  const rowIds = [...new Set(list.slice(0, 300).map((i) => i.rowId))];
  const rows = new Map((await db.migrationRow.findMany({ where: { id: { in: rowIds } } })).map((r) => [r.id, r]));
  const withValue = list.slice(0, 300).map((i: Issue) => {
    const column = i.field ? (fields[i.field]?.column ?? null) : null;
    const r = rows.get(i.rowId);
    const fixed = (r?.fixed as Record<string, unknown> | null) ?? {};
    const value = column && r ? (Object.prototype.hasOwnProperty.call(fixed, column) ? fixed[column] : (r.data as Record<string, unknown>)[column]) : null;
    return { ...i, column, value: value === null || value === undefined ? null : String(value), cleaned: Boolean(column && Object.prototype.hasOwnProperty.call(fixed, column)) };
  });
  return { target, file: built.file, total: built.issues.length, open: built.open, shown: withValue, more: Math.max(0, list.length - 300), canWork: canWorkMigration(actor) && !(await cutOverOf(actor.boardId)) };
}
