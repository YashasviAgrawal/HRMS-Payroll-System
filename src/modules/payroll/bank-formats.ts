/**
 * PR-12: salary bank files in the bank's bulk-upload layout, and the bank's return file of failed credits.
 * Pure functions — the column layouts follow each bank's published corporate bulk templates and must be confirmed
 * with one real upload before go-live (PRD §18). The Board picks its bank's layout in System settings.
 */
import type { ISODate } from "@/lib/dates";

export type BankFormat = "GENERIC_CSV" | "SBI_CMP" | "PNB_BULK" | "BOB_BULK" | "CANARA_BULK";

export interface BankRow {
  employeeCode: string;
  name: string;
  account: string;
  ifsc: string;
  /** Rupees. */
  amount: number;
  narration: string;
}

export interface BankFileOut {
  content: string;
  ext: "csv" | "txt";
  mimeType: string;
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
const amt = (n: number) => n.toFixed(2);
const ddmmyyyy = (d: ISODate) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
/** Names in bank files: capitals, letters, digits and spaces only, at most 35 characters. */
const bankName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 35);

/** Same bank → internal transfer; otherwise NEFT. */
export function paymentMode(ifsc: string, debitIfsc: string): "INTERNAL" | "NEFT" {
  return debitIfsc && ifsc.slice(0, 4) === debitIfsc.slice(0, 4) ? "INTERNAL" : "NEFT";
}

/** The rows of a bank file as a table: the bank's column headings and one row per credit. */
export interface BankTable {
  header: string[];
  rows: (string | number)[][];
  /** How the bank takes it as text: comma-separated with headings, or pipe-separated without (Canara). */
  text: "csv" | "pipe";
}

export function bankTable(format: BankFormat, rows: BankRow[], opts: { debitIfsc: string; valueDate: ISODate }): BankTable {
  const mode = (r: BankRow) => paymentMode(r.ifsc, opts.debitIfsc);
  switch (format) {
    case "SBI_CMP":
      return {
        text: "csv",
        header: ["Beneficiary Name", "Beneficiary Account No", "IFSC", "Transaction Type", "Amount", "Value Date", "Remarks"],
        rows: rows.map((r) => [bankName(r.name), r.account, r.ifsc, mode(r) === "INTERNAL" ? "IFT" : "NEFT", amt(r.amount), ddmmyyyy(opts.valueDate), r.narration]),
      };
    case "PNB_BULK":
      return {
        text: "csv",
        header: ["Account No", "Name", "IFSC", "Amount", "Mode", "Narration"],
        rows: rows.map((r) => [r.account, bankName(r.name), r.ifsc, amt(r.amount), mode(r) === "INTERNAL" ? "TRF" : "NEFT", r.narration]),
      };
    case "BOB_BULK":
      return {
        text: "csv",
        header: ["Beneficiary Account", "Beneficiary Name", "IFSC Code", "Amount", "Payment Type", "Value Date", "Remarks"],
        rows: rows.map((r) => [r.account, bankName(r.name), r.ifsc, amt(r.amount), mode(r) === "INTERNAL" ? "WIB" : "NEFT", ddmmyyyy(opts.valueDate), r.narration]),
      };
    case "CANARA_BULK":
      return {
        text: "pipe",
        header: ["Account No", "Name", "IFSC", "Amount", "Mode", "Narration"],
        rows: rows.map((r) => [r.account, bankName(r.name), r.ifsc, amt(r.amount), mode(r) === "INTERNAL" ? "I" : "N", r.narration.replace(/\|/g, " ")]),
      };
    default:
      return {
        text: "csv",
        header: ["Sl No", "Employee ID", "Beneficiary name", "Account number", "IFSC", "Amount", "Payment mode", "Narration"],
        rows: rows.map((r, i) => [i + 1, r.employeeCode, bankName(r.name), r.account, r.ifsc, amt(r.amount), mode(r), r.narration]),
      };
  }
}

/** The bank file in the bank's own text layout (CSV, or pipe-separated for Canara). */
export function buildBankFile(format: BankFormat, rows: BankRow[], opts: { debitIfsc: string; valueDate: ISODate }): BankFileOut {
  const table = bankTable(format, rows, opts);
  if (table.text === "pipe") return { ext: "txt", mimeType: "text/plain", content: table.rows.map((r) => r.join("|")).join("\r\n") + "\r\n" };
  return { ext: "csv", mimeType: "text/csv", content: csv([table.header, ...table.rows]) };
}

// ─── Return file ──────────────────────────────────────────────────────────────

export interface ReturnRow {
  line: number;
  employeeCode: string;
  amount: number;
  failed: boolean;
  reason: string;
}

/** The Board's return-file template (banks' own return files are mapped to it). */
export const RETURN_COLUMNS = ["Employee ID", "Amount", "Status", "Reason"] as const;
export const RETURN_SAMPLE: string[][] = [
  ["DCB10007", "61234.00", "FAILED", "Account closed"],
  ["DCB10019", "52110.00", "FAILED", "Invalid IFSC"],
];

const FAILED = ["FAILED", "FAIL", "RETURNED", "REJECTED", "UNPAID"];
const CREDITED = ["SUCCESS", "CREDITED", "PAID", "OK", "PROCESSED"];

/**
 * Reads the rows of a return file: finds the columns by their headings (Employee ID, Amount, Status, Reason —
 * in any order), and reports each line it cannot read.
 */
export function parseReturnRows(table: string[][]): { rows: ReturnRow[]; errors: { line: number; problem: "noColumns" | "noEmployee" | "badAmount" | "badStatus" }[] } {
  const errors: { line: number; problem: "noColumns" | "noEmployee" | "badAmount" | "badStatus" }[] = [];
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const ci = { code: col("employee", "emp id", "emp code"), amount: col("amount"), status: col("status"), reason: col("reason", "remark") };
  if (ci.code < 0 || ci.amount < 0) return { rows: [], errors: [{ line: 1, problem: "noColumns" }] };
  const rows: ReturnRow[] = [];
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    if (cells.every((c) => !c?.trim())) return;
    const code = (cells[ci.code] ?? "").trim().toUpperCase();
    if (!code) return errors.push({ line, problem: "noEmployee" });
    const amount = Number((cells[ci.amount] ?? "").replace(/[,\s₹]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) return errors.push({ line, problem: "badAmount" });
    const status = ci.status >= 0 ? (cells[ci.status] ?? "").trim().toUpperCase() : "FAILED";
    if (!FAILED.includes(status) && !CREDITED.includes(status)) return errors.push({ line, problem: "badStatus" });
    rows.push({ line, employeeCode: code, amount, failed: FAILED.includes(status), reason: ci.reason >= 0 ? (cells[ci.reason] ?? "").trim().slice(0, 200) : "" });
  });
  return { rows, errors };
}
