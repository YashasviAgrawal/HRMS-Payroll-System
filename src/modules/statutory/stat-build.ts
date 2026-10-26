/**
 * Builds the monthly statutory files from a month's approved pay bills (regular and supplementary) — NPS contributions
 * for the CRA, the EPFO ECR, the ESIC contribution file and the Board pension fund statement. Pure reading; no
 * "server-only", so the demo seed can file its history months too.
 */
import type { DbLike } from "@/lib/db";
import { ratesOn } from "@/modules/payroll/compute";
import type { PayLine } from "@/modules/payroll/engine";
import { craContributionFile, ecrFile, esicFile, pensionFundFile } from "./formats";
import { statutorySettings } from "./settings";

const fullName = (e: { firstName: string; middleName: string | null; lastName: string | null }) => [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" ");

export const STAT_KINDS = ["stat.nps", "stat.ecr", "stat.esic", "stat.pension"] as const;
export type StatKind = (typeof STAT_KINDS)[number];

const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;
const GROUP: Record<StatKind, "NPS" | "CONTRACT" | "OPS"> = { "stat.nps": "NPS", "stat.ecr": "CONTRACT", "stat.esic": "CONTRACT", "stat.pension": "OPS" };
const sum = (lines: PayLine[], ...codes: string[]) => lines.filter((l) => codes.includes(l.code)).reduce((s, l) => s + l.amount, 0);

/** The figures a file's card and preview show, by code (the screen translates the label). */
export type SumCode = "own" | "board" | "total" | "epfEmployee" | "eps" | "epfEmployer" | "wages" | "esicEmployee" | "esicEmployer" | "basicDa" | "contribution";
export const SUM_LABEL: Record<SumCode, string> = { own: "Employee share (₹)", board: "Board share (₹)", total: "Total (₹)", epfEmployee: "EPF employee (₹)", eps: "EPS (₹)", epfEmployer: "EPF employer (₹)", wages: "Wages (₹)", esicEmployee: "ESIC employee (₹)", esicEmployer: "ESIC employer (₹)", basicDa: "Basic + DA (₹)", contribution: "Board contribution (₹)" };

export interface Built {
  /** The pay group's regular bill for the month is approved. */
  ready: boolean;
  columns: string[];
  rows: (string | number)[][];
  missing: { code: string; name: string }[];
  sums: [SumCode, number][];
  text: string;
  fileName: string;
  ext: "csv" | "txt";
  mime: string;
}

/** Builds one file's rows for a month (used for the screen's counts and for the file itself). */
export async function buildStatFile(tx: DbLike, boardId: string, kind: StatKind, month: string): Promise<Built> {
  const group = GROUP[kind];
  const regular = await tx.payrollRun.findFirst({ where: { boardId, payGroup: group, month, kind: "REGULAR", status: { in: [...PAID] } } });
  const slips = await tx.payslip.findMany({
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
  const settings = await statutorySettings(tx, boardId);
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
      sums: [["own", own], ["board", board], ["total", own + board]],
      text: craContributionFile(ok.map((r) => ({ pran: r.p.e.pran!, name: fullName(r.p.e), employee: r.employee, employer: r.employer })), month, settings.ddoRegNo),
      fileName: `NPS-CRA-${settings.ddoRegNo || "DDO"}-${mm}.csv`,
      ext: "csv",
      mime: "text/csv",
    };
  }
  if (kind === "stat.ecr") {
    const rates = await ratesOn(boardId, `${month}-01`, tx);
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
      sums: [["epfEmployee", ok.reduce((s, r) => s + r.employee, 0)], ["eps", ok.reduce((s, r) => s + r.eps, 0)], ["epfEmployer", ok.reduce((s, r) => s + r.diff, 0)]],
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
      sums: [["wages", ok.reduce((s, r) => s + r.p.gross, 0)], ["esicEmployee", ok.reduce((s, r) => s + r.employee, 0)], ["esicEmployer", ok.reduce((s, r) => s + r.employer, 0)]],
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
    sums: [["basicDa", rows.reduce((s, r) => s + r.basicDa, 0)], ["contribution", rows.reduce((s, r) => s + r.contribution, 0)]],
    text: pensionFundFile(rows.map((r) => ({ code: r.p.e.employeeCode ?? "", name: fullName(r.p.e), basicDa: r.basicDa, contribution: r.contribution })), month),
    fileName: `Pension-fund-${month}.csv`,
    ext: "csv",
    mime: "text/csv",
  };
}

