/**
 * Statutory files as pure builders (§9, ST-06): NPS contribution file for the CRA, EPFO ECR, ESIC monthly contribution,
 * the Board pension fund statement and the Form 24Q text file. Layouts follow the portals' published templates and must
 * be checked with one real upload (and the Protean FVU for 24Q) before go-live (PRD §18).
 */
import { toCsv } from "@/lib/csv";

const amt = (n: number) => n.toFixed(2);
const whole = (n: number) => String(Math.round(n));

// ─── NPS (CRA) ───────────────────────────────────────────────────────────────

export interface NpsRow {
  pran: string;
  name: string;
  employee: number;
  employer: number;
}

export function craContributionFile(rows: NpsRow[], month: string, ddoRegNo: string): string {
  return toCsv(
    ["Sr No", "PRAN", "Subscriber Name", "Employee Contribution", "Employer Contribution", "Total Contribution", "Contribution Month (MMYYYY)", "DDO Reg No", "Remarks"],
    rows.map((r, i) => [i + 1, r.pran, r.name, amt(r.employee), amt(r.employer), amt(r.employee + r.employer), `${month.slice(5, 7)}${month.slice(0, 4)}`, ddoRegNo, ""]),
  );
}

export interface CraStatementRow {
  line: number;
  pran: string;
  month: string;
  employee: number;
  employer: number;
}

/** Reads the CRA's statement of credits: columns found by their headings (PRAN, month, employee, employer). */
export function parseCraStatement(table: string[][]): { rows: CraStatementRow[]; badLines: number[] } {
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const c = { pran: col("pran"), month: col("month", "period"), employee: col("employee", "subscriber contribution", "tier i employee"), employer: col("employer") };
  if (c.pran < 0 || c.employee < 0) return { rows: [], badLines: [1] };
  const rows: CraStatementRow[] = [];
  const badLines: number[] = [];
  table.slice(1).forEach((cells, i) => {
    if (cells.every((x) => !x?.trim())) return;
    const pran = (cells[c.pran] ?? "").replace(/\D/g, "");
    const raw = c.month >= 0 ? (cells[c.month] ?? "").trim() : "";
    const month = /^\d{2}\d{4}$/.test(raw) ? `${raw.slice(2)}-${raw.slice(0, 2)}` : /^\d{4}-\d{2}$/.test(raw) ? raw : /^\d{2}[/-]\d{4}$/.test(raw) ? `${raw.slice(3)}-${raw.slice(0, 2)}` : "";
    const employee = Number((cells[c.employee] ?? "").replace(/[,\s₹]/g, ""));
    const employer = c.employer >= 0 ? Number((cells[c.employer] ?? "").replace(/[,\s₹]/g, "")) : 0;
    if (pran.length !== 12 || !month || !Number.isFinite(employee) || !Number.isFinite(employer)) badLines.push(i + 2);
    else rows.push({ line: i + 2, pran, month, employee, employer });
  });
  return { rows, badLines };
}

// ─── EPF (ECR 2.0) ───────────────────────────────────────────────────────────

export interface EpfRow {
  uan: string;
  name: string;
  gross: number;
  epfWages: number;
  epsWages: number;
  edliWages: number;
  epfEmployee: number;
  eps: number;
  epfEpsDiff: number;
  ncpDays: number;
}

/** EPF / EPS / EDLI split for one worker: 12% employee on EPF wages; EPS 8.33% on wages up to the ceiling; the rest to EPF. */
export function epfSplit(wages: number, gross: number, rates: { epfEmployee: number; epfEmployer: number; epsPercent: number; ceiling: number }) {
  const epfWages = Math.min(wages, rates.ceiling);
  const epsWages = Math.min(epfWages, rates.ceiling);
  const epfEmployee = Math.round((epfWages * rates.epfEmployee) / 100);
  const employerTotal = Math.round((epfWages * rates.epfEmployer) / 100);
  const eps = Math.round((epsWages * rates.epsPercent) / 100);
  return { gross, epfWages, epsWages, edliWages: epsWages, epfEmployee, eps, epfEpsDiff: employerTotal - eps };
}

export function ecrFile(rows: EpfRow[]): string {
  return rows.map((r) => [r.uan, r.name.toUpperCase(), whole(r.gross), whole(r.epfWages), whole(r.epsWages), whole(r.edliWages), whole(r.epfEmployee), whole(r.eps), whole(r.epfEpsDiff), whole(r.ncpDays), "0"].join("#~#")).join("\n") + "\n";
}

// ─── ESIC ────────────────────────────────────────────────────────────────────

export interface EsicRow {
  ipNumber: string;
  name: string;
  days: number;
  wages: number;
  lastWorkingDay: string | null;
}

export function esicFile(rows: EsicRow[]): string {
  return toCsv(
    ["IP Number", "IP Name", "No of Days for which wages paid/payable during the month", "Total Monthly Wages", "Reason Code for Zero workings days", "Last Working Day"],
    rows.map((r) => [r.ipNumber, r.name, r.days, whole(r.wages), r.days === 0 ? "1" : "0", r.lastWorkingDay ?? ""]),
  );
}

// ─── Board pension fund (CBAR 2020) ──────────────────────────────────────────

export interface PensionFundRow {
  code: string;
  name: string;
  basicDa: number;
  contribution: number;
}

export function pensionFundFile(rows: PensionFundRow[], month: string): string {
  return toCsv(["Month", "Employee ID", "Name", "Basic + DA", "Board contribution (10%)"], rows.map((r) => [month, r.code, r.name, whole(r.basicDa), whole(r.contribution)]));
}

// ─── Form 24Q (quarterly TDS on salary) ──────────────────────────────────────

export interface Deductor {
  tan: string;
  pan: string;
  name: string;
  address: string;
  responsible: string;
  designation: string;
}

export interface ChallanRow {
  bsrCode: string;
  challanNo: string;
  depositedOn: string;
  tax: number;
  cess: number;
  interest: number;
  deductees: { pan: string; name: string; paid: number; tds: number; paidOn: string }[];
}

const d8 = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;

/** Annexure II (salary details for the year), sent with the fourth quarter's statement. */
export interface SalaryDetailRow {
  pan: string;
  name: string;
  from: string;
  to: string;
  newRegime: boolean;
  gross: number;
  standardDeduction: number;
  hraExempt: number;
  professionalTax: number;
  otherIncome: number;
  chapterVIA: number;
  taxable: number;
  tax: number;
  rebate: number;
  cess: number;
  tds: number;
}

/**
 * Spreads each month's deductees over that month's challans in order (a deductee may be split across two challans),
 * as the statement needs every rupee of TDS booked under a challan. Returns the months short of deposit.
 */
export function allocateToChallans<T extends { tds: number }>(challans: { id: string; amount: number }[], deductees: T[]) {
  const out = new Map<string, (T & { tds: number })[]>(challans.map((c) => [c.id, []]));
  const left = challans.map((c) => ({ id: c.id, room: Math.round(c.amount * 100) }));
  let short = 0;
  for (const d of deductees) {
    let need = Math.round(d.tds * 100);
    for (const c of left) {
      if (need <= 0) break;
      if (c.room <= 0) continue;
      const take = Math.min(c.room, need);
      out.get(c.id)!.push({ ...d, tds: take / 100 });
      c.room -= take;
      need -= take;
    }
    short += need;
  }
  return { byChallan: out, short: short / 100 };
}

/**
 * Form 24Q as the "^"-separated text file the Protean / TRACES file validation utility reads: file header (FH), batch
 * header (BH), one challan detail (CD) per challan and a deductee detail (DD) per person paid under it, and in the
 * fourth quarter the salary details (SD, Annexure II). Field order follows the regular-statement layout; to be run
 * through the FVU before filing (PRD §18).
 */
export function form24qFile(d: Deductor, fy: string, quarter: 1 | 2 | 3 | 4, challans: ChallanRow[], createdOn: string, salaryDetails: SalaryDetailRow[] = []): string {
  const ay = `${Number(fy.slice(0, 4)) + 1}${String((Number(fy.slice(0, 4)) + 2) % 100).padStart(2, "0")}`;
  const fyCode = `${fy.slice(0, 4)}${String((Number(fy.slice(0, 4)) + 1) % 100).padStart(2, "0")}`;
  const lines: string[] = [];
  let n = 1;
  const total = challans.reduce((s, c) => s + c.tax + c.cess + c.interest, 0);
  const sd = quarter === 4 ? salaryDetails : [];
  lines.push(["" + n++, "FH", "NS1", "R", d8(createdOn), "1", "D", d.tan, "1", "DCB-HRMS", "", "", "", "", "", "", ""].join("^"));
  lines.push(
    ["" + n++, "BH", "1", String(challans.length), "24Q", "", "", "", "", "", "", "", d.tan, "", d.pan, ay, fyCode, `Q${quarter}`, d.name, "", d.address, "", "", "", "", "", "", "", "", "", "", d.responsible, d.designation, "", "", "", amt(total), "", String(sd.length), "", "", "N", "N", "A"].join("^"),
  );
  challans.forEach((c, ci) => {
    const deposited = c.tax + c.cess + c.interest;
    lines.push(["" + n++, "CD", "1", String(ci + 1), String(c.deductees.length), "N", "", "", "", "", "", "", c.challanNo, "", "", "", c.bsrCode, "", d8(c.depositedOn), "", "", "200", "", amt(c.tax), "0.00", amt(c.cess), amt(c.interest), "0.00", amt(deposited), "", amt(c.deductees.reduce((s, x) => s + x.tds, 0)), "", "", "N"].join("^"));
    c.deductees.forEach((x, xi) => {
      const cess = Math.round((x.tds * 4) / 104);
      lines.push(["" + n++, "DD", "1", String(ci + 1), String(xi + 1), "O", "", "", x.pan, "", "", x.name, amt(x.tds - cess), "0.00", amt(cess), amt(x.tds), "", amt(x.tds), "", amt(x.paid), d8(x.paidOn), d8(c.depositedOn), "", "", "", "", "", "", "", "", "", ""].join("^"));
    });
  });
  sd.forEach((r, i) => {
    lines.push(
      ["" + n++, "SD", "1", String(i + 1), "A", "", r.pan, "", r.name, "G", d8(r.from), d8(r.to), amt(r.gross), amt(r.hraExempt), amt(r.gross - r.hraExempt), amt(r.standardDeduction), "0.00", amt(r.professionalTax), amt(r.standardDeduction + r.professionalTax), amt(r.gross - r.hraExempt - r.standardDeduction - r.professionalTax), amt(r.otherIncome), amt(r.gross - r.hraExempt - r.standardDeduction - r.professionalTax + r.otherIncome), amt(r.chapterVIA), amt(r.taxable), amt(r.tax), amt(r.rebate), amt(r.cess), "0.00", amt(r.tax - r.rebate + r.cess), amt(r.tds), "0.00", amt(r.tds), amt(r.tax - r.rebate + r.cess - r.tds), r.newRegime ? "N" : "Y", "", "", ""].join("^"),
    );
  });
  return lines.join("\r\n") + "\r\n";
}
