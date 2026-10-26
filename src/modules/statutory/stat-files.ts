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
import { ratesOn } from "@/modules/payroll/compute";
import type { PayLine } from "@/modules/payroll/engine";
import { readTable } from "@/modules/payroll/pay";
import { craContributionFile, ecrFile, esicFile, parseCraStatement, pensionFundFile } from "./formats";
import { statutorySettings } from "./settings";

/**
 * ST-06, ST-09, S-52: the monthly statutory files, built from the month's approved pay bills (regular and supplementary)
 * — NPS contributions for the CRA, the EPFO ECR, the ESIC contribution file and the Board pension fund statement (CBAR
 * 2020, due within 4 days of the pay bill). Each is previewed and released by an Admin, with its checksum logged.
 * Also: the CRA statement upload that reconciles what the CRA credited with what the pay bills deducted (§9 NPS).
 */
export const STAT_KINDS = ["stat.nps", "stat.ecr", "stat.esic", "stat.pension"] as const;
export type StatKind = (typeof STAT_KINDS)[number];

const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;
const canSee = (actor: Actor) => canAll(actor, "statutory", "view");
const canManage = (actor: Actor) => canAll(actor, "statutory", "create");
const GROUP: Record<StatKind, "NPS" | "CONTRACT" | "OPS"> = { "stat.nps": "NPS", "stat.ecr": "CONTRACT", "stat.esic": "CONTRACT", "stat.pension": "OPS" };
const sum = (lines: PayLine[], ...codes: string[]) => lines.filter((l) => codes.includes(l.code)).reduce((s, l) => s + l.amount, 0);

interface Built {
  /** The pay group's regular bill for the month is approved. */
  ready: boolean;
  columns: string[];
  rows: (string | number)[][];
  missing: { code: string; name: string }[];
  totals: Record<string, string | number>;
  text: string;
  fileName: string;
  ext: "csv" | "txt";
  mime: string;
}

/** Builds one file's rows for a month (used for the screen's counts and for the file itself). */
async function build(boardId: string, kind: StatKind, month: string): Promise<Built> {
  const group = GROUP[kind];
  const regular = await db.payrollRun.findFirst({ where: { boardId, payGroup: group, month, kind: "REGULAR", status: { in: [...PAID] } } });
  const slips = await db.payslip.findMany({
    where: { boardId, month, payGroup: group, status: "INCLUDED", run: { status: { in: [...PAID] } } },
    include: { employee: { select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, pran: true, uan: true, esicNumber: true, type: true, wageBasis: true, exitDate: true } } },
    orderBy: { employee: { employeeCode: "asc" } },
  });
  // One row a person: a month's regular and supplementary bills together.
  const people = new Map<string, { e: (typeof slips)[number]["employee"]; lines: PayLine[]; gross: number; days: number; ncp: number; dim: number }>();
  for (const s of slips) {
    const p = people.get(s.employeeId) ?? { e: s.employee, lines: [], gross: 0, days: 0, ncp: 0, dim: s.daysInMonth };
    p.lines.push(...(s.lines as unknown as PayLine[]));
    p.gross += num(s.gross);
    if (num(s.daysOnRoll) > 0) {
      p.days = s.workedDays !== null && s.employee.wageBasis === "DAILY" ? num(s.workedDays) : num(s.daysOnRoll) - num(s.lossDays);
      p.ncp = Math.max(0, Math.round(num(s.lossDays) + num(s.daysInMonth) - num(s.daysOnRoll)));
    }
    people.set(s.employeeId, p);
  }
  const settings = await statutorySettings(db, boardId);
  const missing: { code: string; name: string }[] = [];
  const mm = `${month.slice(5, 7)}${month.slice(0, 4)}`;
  if (kind === "stat.nps") {
    const rows = [...people.values()].map((p) => ({ p, employee: sum(p.lines, "NPS"), employer: sum(p.lines, "NPS_ER") })).filter((r) => r.employee + r.employer > 0);
    const ok = rows.filter((r) => (r.p.e.pran ?? "").length === 12);
    for (const r of rows) if (!ok.includes(r)) missing.push({ code: r.p.e.employeeCode ?? "", name: fullName(r.p.e) });
    const own = ok.reduce((s, r) => s + r.employee, 0);
    const board = ok.reduce((s, r) => s + r.employer, 0);
    return {
      ready: Boolean(regular),
      columns: ["PRAN", "Name", "Employee (₹)", "Board (₹)"],
      rows: ok.map((r) => [r.p.e.pran!, fullName(r.p.e), r.employee, r.employer]),
      missing,
      totals: { "Employee share (₹)": formatINR(own), "Board share (₹)": formatINR(board), "Total (₹)": formatINR(own + board) },
      text: craContributionFile(ok.map((r) => ({ pran: r.p.e.pran!, name: fullName(r.p.e), employee: r.employee, employer: r.employer })), month, settings.ddoRegNo),
      fileName: `NPS-CRA-${settings.ddoRegNo || "DDO"}-${mm}.csv`,
      ext: "csv",
      mime: "text/csv",
    };
  }
  if (kind === "stat.ecr") {
    const rates = await ratesOn(boardId, `${month}-01`, db);
    const ceiling = rates.EPF_CEILING ?? 15000;
    const rows = [...people.values()].map((p) => {
      const wages = sum(p.lines, "WAGES");
      const epfWages = Math.min(wages, ceiling);
      const eps = Math.round((epfWages * (rates.EPS_PERCENT ?? 8.33)) / 100);
      const er = sum(p.lines, "EPF_ER");
      return { p, gross: Math.round(p.gross), epfWages, eps: Math.min(eps, er), employee: sum(p.lines, "EPF"), diff: Math.max(0, er - Math.min(eps, er)) };
    }).filter((r) => r.employee > 0);
    const ok = rows.filter((r) => (r.p.e.uan ?? "").length === 12);
    for (const r of rows) if (!ok.includes(r)) missing.push({ code: r.p.e.employeeCode ?? "", name: fullName(r.p.e) });
    return {
      ready: Boolean(regular),
      columns: ["UAN", "Name", "Gross (₹)", "EPF wages (₹)", "EPF employee (₹)", "EPS (₹)", "EPF employer (₹)", "NCP days"],
      rows: ok.map((r) => [r.p.e.uan!, fullName(r.p.e), r.gross, r.epfWages, r.employee, r.eps, r.diff, r.p.ncp]),
      missing,
      totals: { "EPF employee (₹)": formatINR(ok.reduce((s, r) => s + r.employee, 0)), "EPS (₹)": formatINR(ok.reduce((s, r) => s + r.eps, 0)), "EPF employer (₹)": formatINR(ok.reduce((s, r) => s + r.diff, 0)) },
      text: ecrFile(ok.map((r) => ({ uan: r.p.e.uan!, name: fullName(r.p.e), gross: r.gross, epfWages: r.epfWages, epsWages: r.epfWages, edliWages: r.epfWages, epfEmployee: r.employee, eps: r.eps, epfEpsDiff: r.diff, ncpDays: r.p.ncp }))),
      fileName: `ECR-${settings.epfCode || "EPF"}-${mm}.txt`,
      ext: "txt",
      mime: "text/plain",
    };
  }
  if (kind === "stat.esic") {
    const rows = [...people.values()].map((p) => ({ p, employee: sum(p.lines, "ESIC"), employer: sum(p.lines, "ESIC_ER") })).filter((r) => r.employee + r.employer > 0);
    const ok = rows.filter((r) => (r.p.e.esicNumber ?? "").length === 10);
    for (const r of rows) if (!ok.includes(r)) missing.push({ code: r.p.e.employeeCode ?? "", name: fullName(r.p.e) });
    return {
      ready: Boolean(regular),
      columns: ["IP number", "Name", "Days paid", "Wages (₹)", "Employee (₹)", "Employer (₹)"],
      rows: ok.map((r) => [r.p.e.esicNumber!, fullName(r.p.e), r.p.days, Math.round(r.p.gross), r.employee, r.employer]),
      missing,
      totals: { "Wages (₹)": formatINR(ok.reduce((s, r) => s + r.p.gross, 0)), "Employee share (₹)": formatINR(ok.reduce((s, r) => s + r.employee, 0)), "Employer share (₹)": formatINR(ok.reduce((s, r) => s + r.employer, 0)) },
      text: esicFile(ok.map((r) => ({ ipNumber: r.p.e.esicNumber!, name: fullName(r.p.e), days: r.p.days, wages: r.p.gross, lastWorkingDay: r.p.e.exitDate ? r.p.e.exitDate.toISOString().slice(0, 10).split("-").reverse().join("/") : null }))),
      fileName: `ESIC-${settings.esicCode || "ESIC"}-${mm}.csv`,
      ext: "csv",
      mime: "text/csv",
    };
  }
  const rows = [...people.values()].map((p) => ({ p, basicDa: sum(p.lines, "BASIC", "DA", "NPA"), contribution: sum(p.lines, "PENSION_ER") })).filter((r) => r.contribution > 0);
  return {
    ready: Boolean(regular),
    columns: ["Employee ID", "Name", "Basic + DA (₹)", "Board contribution (₹)"],
    rows: rows.map((r) => [r.p.e.employeeCode ?? "", fullName(r.p.e), r.basicDa, r.contribution]),
    missing,
    totals: { "Basic + DA (₹)": formatINR(rows.reduce((s, r) => s + r.basicDa, 0)), "Board contribution (₹)": formatINR(rows.reduce((s, r) => s + r.contribution, 0)) },
    text: pensionFundFile(rows.map((r) => ({ code: r.p.e.employeeCode ?? "", name: fullName(r.p.e), basicDa: r.basicDa, contribution: r.contribution })), month),
    fileName: `Pension-fund-${month}.csv`,
    ext: "csv",
    mime: "text/csv",
  };
}

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
      return { kind, ready: b.ready, people: b.rows.length, totals: b.totals, missing: b.missing, latest: latest ? { id: latest.id, status: latest.status, fileName: latest.fileName, sha256: latest.sha256, createdAt: latest.createdAt.toISOString() } : null };
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
    preview: { columns: b.columns, rows: b.rows.slice(0, 50), totalRows: b.rows.length, totals: { ...b.totals, ...(b.missing.length ? { "Left out (number missing)": b.missing.map((m) => m.code).join(", ") } : {}) } },
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
