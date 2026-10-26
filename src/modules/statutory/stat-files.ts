import "server-only";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatMonth, isMonth, todayIST } from "@/lib/dates";
import { badRequest, conflict, forbidden } from "@/lib/errors";
import { createOutgoingFile } from "@/lib/files";
import { formatINR } from "@/lib/money";
import { saveFile } from "@/lib/storage";
import { fullName } from "@/modules/employees/present";
import type { PayLine } from "@/modules/payroll/engine";
import { readTable } from "@/modules/payroll/pay";
import { parseCraStatement } from "./formats";
import { statutorySettings } from "./settings";
import { buildStatFile, STAT_KINDS, SUM_LABEL, type StatKind } from "./stat-build";

export { STAT_KINDS, type StatKind } from "./stat-build";

/**
 * ST-06, ST-09, S-52: the monthly statutory files, built from the month's approved pay bills (regular and supplementary)
 * — NPS contributions for the CRA, the EPFO ECR, the ESIC contribution file and the Board pension fund statement (CBAR
 * 2020, due within 4 days of the pay bill). Each is previewed and released by an Admin, with its checksum logged.
 * Also: the CRA statement upload that reconciles what the CRA credited with what the pay bills deducted (§9 NPS).
 */
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;
const canSee = (actor: Actor) => canAll(actor, "statutory", "view");
const canManage = (actor: Actor) => canAll(actor, "statutory", "create");
const sum = (lines: PayLine[], ...codes: string[]) => lines.filter((l) => codes.includes(l.code)).reduce((s, l) => s + l.amount, 0);
const build = (boardId: string, kind: StatKind, month: string) => buildStatFile(db, boardId, kind, month);

/** S-52 files tab: for a month, each file's people, totals, who is left out and the latest file made. */
export async function monthFiles(actor: Actor, monthParam?: string) {
  if (!canSee(actor)) throw forbidden();
  const runs = await db.payrollRun.findMany({ where: { boardId: actor.boardId, kind: "REGULAR", status: { in: [...PAID] } }, select: { month: true }, distinct: ["month"], orderBy: { month: "desc" } });
  const months = runs.map((r) => r.month);
  const month = monthParam && isMonth(monthParam) ? monthParam : (months[0] ?? todayIST().slice(0, 7));
  const [files, built] = await Promise.all([
    db.fileRecord.findMany({ where: { boardId: actor.boardId, kind: { in: [...STAT_KINDS] }, period: month }, orderBy: { createdAt: "desc" } }),
    Promise.all(STAT_KINDS.map((k) => build(actor.boardId, k, month))),
  ]);
  return {
    month,
    months,
    cards: STAT_KINDS.map((kind, i) => {
      const b = built[i];
      const latest = files.find((f) => f.kind === kind);
      return { kind, ready: b.ready, people: b.rows.length, sums: b.sums, missing: b.missing, latest: latest ? { id: latest.id, status: latest.status, fileName: latest.fileName, sha256: latest.sha256, createdAt: latest.createdAt.toISOString() } : null };
    }),
    files: files.map((f) => ({ id: f.id, kind: f.kind, status: f.status, fileName: f.fileName, sha256: f.sha256, createdAt: f.createdAt.toISOString(), createdByName: f.createdByName })),
    canManage: canManage(actor),
  };
}

const TITLES: Record<StatKind, [string, string]> = {
  "stat.nps": ["NPS contribution file (CRA)", "एनपीएस अंशदान फ़ाइल (सीआरए)"],
  "stat.ecr": ["EPF return (ECR)", "ईपीएफ रिटर्न (ईसीआर)"],
  "stat.esic": ["ESIC contribution file", "ईएसआईसी अंशदान फ़ाइल"],
  "stat.pension": ["Board pension fund statement", "परिषद पेंशन निधि विवरण"],
};

/** Builds a month's file and sends it to an Admin to release (ST-09). */
export async function makeStatFile(actor: Actor, kind: StatKind, month: string) {
  if (!canManage(actor)) throw forbidden();
  if (!STAT_KINDS.includes(kind) || !isMonth(month)) throw badRequest("errors.validation");
  const waiting = await db.fileRecord.findFirst({ where: { boardId: actor.boardId, kind, period: month, status: "PREVIEW" } });
  if (waiting) throw conflict("statutory.files.waiting");
  const b = await build(actor.boardId, kind, month);
  if (!b.ready) throw conflict("statutory.files.payrollNotApproved");
  if (!b.rows.length) throw conflict("statutory.files.nobody");
  if (kind === "stat.nps" && !(await statutorySettings(db, actor.boardId)).ddoRegNo) throw badRequest("statutory.files.needDdo");
  const [en, hi] = TITLES[kind];
  return createOutgoingFile(actor, {
    kind,
    period: month,
    fileName: b.fileName,
    ext: b.ext,
    mimeType: b.mime,
    buffer: Buffer.from(b.text, "utf8"),
    preview: { columns: b.columns, rows: b.rows.slice(0, 50), totalRows: b.rows.length, totals: { ...Object.fromEntries(b.sums.map(([k, v]) => [SUM_LABEL[k], formatINR(v)])), ...(b.missing.length ? { "Left out (number missing)": b.missing.map((m) => m.code).join(", ") } : {}) } },
    title: `${en} — ${formatMonth(month)}`,
    titleHi: `${hi} — ${formatMonth(month, "hi")}`,
    link: `/statutory/files?month=${month}`,
  });
}

// ─── NPS: CRA statement reconciliation ────────────────────────────────────────

export interface ReconLine {
  pran: string;
  month: string;
  code: string | null;
  name: string | null;
  ours: { employee: number; employer: number } | null;
  cra: { employee: number; employer: number } | null;
  status: "MATCHED" | "DIFFERENT" | "NOT_CREDITED" | "NOT_OURS";
}

/** §9: what the CRA credited against what the approved pay bills deducted, PRAN by PRAN, month by month. */
export async function reconcileCra(actor: Actor, fileName: string, buffer: Buffer) {
  if (!canManage(actor)) throw forbidden();
  const { rows, badLines } = parseCraStatement(await readTable(buffer));
  if (!rows.length) throw badRequest("statutory.nps.badStatement", undefined, { lines: badLines.slice(0, 10).join(", ") || "1" });
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const slips = await db.payslip.findMany({
    where: { boardId: actor.boardId, month: { in: months }, payGroup: "NPS", status: "INCLUDED", run: { status: { in: [...PAID] } } },
    select: { month: true, lines: true, employee: { select: { pran: true, employeeCode: true, firstName: true, middleName: true, lastName: true } } },
  });
  const ours = new Map<string, { employee: number; employer: number; code: string; name: string }>();
  const names = new Map<string, { code: string; name: string }>();
  for (const s of slips) {
    const pran = s.employee.pran ?? "";
    const k = `${pran}|${s.month}`;
    const lines = s.lines as unknown as PayLine[];
    const cur = ours.get(k) ?? { employee: 0, employer: 0, code: s.employee.employeeCode ?? "", name: fullName(s.employee) };
    cur.employee += sum(lines, "NPS");
    cur.employer += sum(lines, "NPS_ER");
    ours.set(k, cur);
    names.set(pran, { code: cur.code, name: cur.name });
  }
  const cra = new Map<string, { employee: number; employer: number }>();
  for (const r of rows) {
    const k = `${r.pran}|${r.month}`;
    const cur = cra.get(k) ?? { employee: 0, employer: 0 };
    cra.set(k, { employee: cur.employee + r.employee, employer: cur.employer + r.employer });
  }
  const lines: ReconLine[] = [];
  for (const k of new Set([...ours.keys(), ...cra.keys()])) {
    const [pran, month] = k.split("|");
    const o = ours.get(k);
    const c = cra.get(k);
    if (o && o.employee + o.employer === 0 && !c) continue;
    const same = o && c && Math.abs(o.employee - c.employee) < 1 && Math.abs(o.employer - c.employer) < 1;
    lines.push({ pran, month, code: names.get(pran)?.code ?? null, name: names.get(pran)?.name ?? null, ours: o ? { employee: o.employee, employer: o.employer } : null, cra: c ?? null, status: same ? "MATCHED" : o && c ? "DIFFERENT" : o ? "NOT_CREDITED" : "NOT_OURS" });
  }
  lines.sort((a, b) => (a.status === "MATCHED" ? 1 : 0) - (b.status === "MATCHED" ? 1 : 0) || a.month.localeCompare(b.month) || a.pran.localeCompare(b.pran));
  const summary = { matched: lines.filter((l) => l.status === "MATCHED").length, different: lines.filter((l) => l.status === "DIFFERENT").length, notCredited: lines.filter((l) => l.status === "NOT_CREDITED").length, notOurs: lines.filter((l) => l.status === "NOT_OURS").length, badLines, months };
  const stored = await saveFile("files", buffer, fileName.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv");
  const record = await db.$transaction(async (tx) => {
    const f = await tx.fileRecord.create({
      data: { boardId: actor.boardId, direction: "INCOMING", kind: "nps.cra", period: months.join(","), fileName: fileName.slice(0, 200), mimeType: "text/csv", size: stored.size, sha256: stored.sha256, storageKey: stored.key, status: "VALIDATED", meta: JSON.parse(JSON.stringify({ summary, lines: lines.filter((l) => l.status !== "MATCHED").slice(0, 300) })), createdById: actor.userId, createdByName: actor.name },
    });
    await audit(tx, actor, { action: "UPLOAD", entityType: "FileRecord", entityId: f.id, summary: `CRA statement ${fileName} reconciled: ${summary.matched} matched, ${summary.different} different, ${summary.notCredited} not credited, ${summary.notOurs} not ours` });
    return f;
  });
  return { id: record.id, summary, lines };
}

/** Earlier CRA statements and what they found. */
export async function craReconciliations(actor: Actor) {
  if (!canSee(actor)) throw forbidden();
  const rows = await db.fileRecord.findMany({ where: { boardId: actor.boardId, kind: "nps.cra" }, orderBy: { createdAt: "desc" }, take: 12 });
  return rows.map((r) => ({ id: r.id, fileName: r.fileName, createdAt: r.createdAt.toISOString(), createdByName: r.createdByName, ...((r.meta ?? {}) as unknown as { summary: Record<string, unknown>; lines: ReconLine[] }) }));
}

/** S-50 NPS: contributions per person from the pay bills — this year and to date. */
export async function npsAccounts(actor: Actor) {
  if (!canSee(actor)) throw forbidden();
  const today = todayIST();
  const fyStart = `${Number(today.slice(5, 7)) >= 4 ? today.slice(0, 4) : Number(today.slice(0, 4)) - 1}-04`;
  const slips = await db.payslip.findMany({
    where: { boardId: actor.boardId, payGroup: "NPS", status: "INCLUDED", run: { status: { in: [...PAID] } } },
    select: { month: true, lines: true, employee: { select: { id: true, pran: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true } } },
  });
  const by = new Map<string, { employeeId: string; code: string; name: string; nameHi: string | null; pran: string | null; year: number; yearBoard: number; total: number; totalBoard: number; lastMonth: string }>();
  for (const s of slips) {
    const lines = s.lines as unknown as PayLine[];
    const e = s.employee;
    const cur = by.get(e.id) ?? { employeeId: e.id, code: e.employeeCode ?? "", name: fullName(e), nameHi: e.nameHi, pran: e.pran, year: 0, yearBoard: 0, total: 0, totalBoard: 0, lastMonth: "" };
    const own = sum(lines, "NPS");
    const board = sum(lines, "NPS_ER");
    cur.total += own;
    cur.totalBoard += board;
    if (s.month >= fyStart) {
      cur.year += own;
      cur.yearBoard += board;
    }
    if (s.month > cur.lastMonth) cur.lastMonth = s.month;
    by.set(e.id, cur);
  }
  return [...by.values()].sort((a, b) => a.code.localeCompare(b.code));
}
