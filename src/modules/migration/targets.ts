/**
 * §15 step 4: what each old-system table becomes here — the fields of every load target, the code lists that translate
 * FoxPro values (pay codes, sections, posts, types), and the rules that read a staged value (step 5: dates written any
 * old way, amounts with commas, Kruti Dev names, full names split). Pure; the service and the tests share it.
 */
import { isISODate } from "@/lib/dates";
import { krutiToUnicode } from "./krutidev";

export const TARGETS = ["employees", "leave", "gpf", "loans", "tax", "pensioners", "payTotals", "parallel"] as const;
export type TargetKey = (typeof TARGETS)[number];

export type Transform = "none" | "kruti" | "upper";
export type FieldKind = "text" | "date" | "money" | "number" | "code" | "month";
export type CodeList = "type" | "section" | "post" | "gender" | "category" | "loanType" | "pensionType" | "relation" | "head" | "yesNo";

export interface FieldDef {
  key: string;
  kind: FieldKind;
  required?: boolean;
  list?: CodeList;
  /** Offer the Kruti Dev conversion. */
  hindi?: boolean;
}

export interface FieldMap {
  column: string | null;
  transform?: Transform;
  /** A value for every row when the old table has no such column (for example the employee type of a contract table). */
  constant?: string | null;
}
export type Fields = Record<string, FieldMap>;
export type Codes = Partial<Record<CodeList, Record<string, string>>>;

export interface Options {
  /** As-on date of opening balances (the day before cut-over). */
  asOn?: string;
  /** Financial year of the tax carried in. */
  fy?: string;
  /** Only rows whose column holds one of these values (a "working" flag, a month). */
  filterColumn?: string;
  filterValues?: string;
  /** Section and post for former employees created with a pension. */
  sectionCode?: string;
  postCode?: string;
  /** Money totals check: FoxPro's own monthly figures (from its printed bills), entered by Payroll. */
  control?: Record<string, { gross: number; deductions: number; net: number }>;
  /** Parallel run: one row per person and head ("long"), or one column per head ("wide"). */
  layout?: "long" | "wide";
}

const EMPLOYEE_FIELDS: FieldDef[] = [
  { key: "employeeCode", kind: "text", required: true },
  { key: "fullName", kind: "text" },
  { key: "firstName", kind: "text" },
  { key: "middleName", kind: "text" },
  { key: "lastName", kind: "text" },
  { key: "nameHi", kind: "text", hindi: true },
  { key: "gender", kind: "code", list: "gender", required: true },
  { key: "dateOfBirth", kind: "date", required: true },
  { key: "dateOfJoining", kind: "date", required: true },
  { key: "type", kind: "code", list: "type", required: true },
  { key: "sectionCode", kind: "code", list: "section", required: true },
  { key: "postCode", kind: "code", list: "post", required: true },
  { key: "payLevel", kind: "text" },
  { key: "payCell", kind: "number" },
  { key: "wageRate", kind: "money" },
  { key: "wageBasis", kind: "text" },
  { key: "contractStart", kind: "date" },
  { key: "contractEnd", kind: "date" },
  { key: "mobile", kind: "text" },
  { key: "email", kind: "text" },
  { key: "fatherOrSpouseName", kind: "text" },
  { key: "category", kind: "code", list: "category" },
  { key: "pan", kind: "text" },
  { key: "aadhaar", kind: "text" },
  { key: "pran", kind: "text" },
  { key: "uan", kind: "text" },
  { key: "esicNumber", kind: "text" },
  { key: "gpfNumber", kind: "text" },
  { key: "bankAccount", kind: "text" },
  { key: "ifsc", kind: "text" },
  { key: "bankName", kind: "text" },
];

export interface TargetDef {
  key: TargetKey;
  /** The permission that maps and loads it (Accounts signs every mapping off). */
  owner: "HR" | "PAYROLL" | "PENSION";
  options: (keyof Options)[];
  /** Leave balances add a field per leave type at run time. */
  fields: FieldDef[];
  /** Makes records (false for the two comparison targets). */
  loads: boolean;
}

export const TARGET_DEFS: Record<TargetKey, TargetDef> = {
  employees: { key: "employees", owner: "HR", options: ["filterColumn", "filterValues"], fields: EMPLOYEE_FIELDS, loads: true },
  leave: { key: "leave", owner: "HR", options: ["asOn", "filterColumn", "filterValues"], fields: [{ key: "employeeCode", kind: "text", required: true }], loads: true },
  gpf: {
    key: "gpf",
    owner: "PAYROLL",
    options: ["asOn", "filterColumn", "filterValues"],
    fields: [
      { key: "employeeCode", kind: "text", required: true },
      { key: "balance", kind: "money", required: true },
    ],
    loads: true,
  },
  loans: {
    key: "loans",
    owner: "PAYROLL",
    options: ["asOn", "filterColumn", "filterValues"],
    fields: [
      { key: "employeeCode", kind: "text", required: true },
      { key: "loanType", kind: "code", list: "loanType", required: true },
      { key: "principalLeft", kind: "money", required: true },
      { key: "interestLeft", kind: "money" },
      { key: "instalment", kind: "money", required: true },
      { key: "interestRate", kind: "number" },
      { key: "sanctionDate", kind: "date" },
      { key: "orderNumber", kind: "text" },
    ],
    loads: true,
  },
  tax: {
    key: "tax",
    owner: "PAYROLL",
    options: ["fy", "filterColumn", "filterValues"],
    fields: [
      { key: "employeeCode", kind: "text", required: true },
      { key: "salary", kind: "money", required: true },
      { key: "tds", kind: "money", required: true },
    ],
    loads: true,
  },
  pensioners: {
    key: "pensioners",
    owner: "PENSION",
    options: ["sectionCode", "postCode", "filterColumn", "filterValues"],
    fields: [
      { key: "ppoNumber", kind: "text", required: true },
      { key: "pensionType", kind: "code", list: "pensionType", required: true },
      { key: "relation", kind: "code", list: "relation" },
      { key: "payeeName", kind: "text", required: true },
      { key: "payeeNameHi", kind: "text", hindi: true },
      { key: "payeeDob", kind: "date", required: true },
      { key: "retireeCode", kind: "text" },
      { key: "retireeName", kind: "text" },
      { key: "retireeGender", kind: "code", list: "gender", required: true },
      { key: "retireeDob", kind: "date" },
      { key: "dateOfJoining", kind: "date", required: true },
      { key: "retirementDate", kind: "date", required: true },
      { key: "deathDate", kind: "date" },
      { key: "retireeSection", kind: "code", list: "section" },
      { key: "retireePost", kind: "code", list: "post" },
      { key: "mobile", kind: "text" },
      { key: "bankAccount", kind: "text", required: true },
      { key: "ifsc", kind: "text", required: true },
      { key: "bankName", kind: "text" },
      { key: "basicPension", kind: "money", required: true },
      { key: "commutedAmount", kind: "money" },
      { key: "commutationDate", kind: "date" },
      { key: "reducedPension", kind: "money" },
      { key: "reducedFrom", kind: "date" },
      { key: "startDate", kind: "date", required: true },
      { key: "lastCertificate", kind: "date" },
      { key: "fmaEligible", kind: "code", list: "yesNo" },
      { key: "lastBasicPaid", kind: "money" },
      { key: "lastDrPaid", kind: "money" },
    ],
    loads: true,
  },
  payTotals: {
    key: "payTotals",
    owner: "PAYROLL",
    options: ["filterColumn", "filterValues", "control"],
    fields: [
      { key: "month", kind: "month", required: true },
      { key: "employeeCode", kind: "text" },
      { key: "gross", kind: "money", required: true },
      { key: "deductions", kind: "money", required: true },
      { key: "net", kind: "money", required: true },
    ],
    loads: false,
  },
  parallel: {
    key: "parallel",
    owner: "PAYROLL",
    options: ["layout", "filterColumn", "filterValues"],
    fields: [
      { key: "employeeCode", kind: "text", required: true },
      { key: "head", kind: "code", list: "head" },
      { key: "amount", kind: "money" },
    ],
    loads: false,
  },
};

/** Values a code list may take here (sections, posts and pay heads come from the Board's own masters). */
export const FIXED_LISTS: Partial<Record<CodeList, readonly string[]>> = {
  type: ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION", "CONTRACT", "DAILY_WAGE", "REEMPLOYED"],
  gender: ["M", "F", "T"],
  category: ["GEN", "OBC", "SC", "ST", "EWS"],
  loanType: ["HBA", "VEHICLE", "COMPUTER", "FESTIVAL", "OTHER"],
  pensionType: ["SUPERANNUATION", "VOLUNTARY", "INVALID", "COMPULSORY", "FAMILY"],
  relation: ["SELF", "SPOUSE", "SON", "DAUGHTER", "MOTHER", "FATHER", "OTHER"],
  yesNo: ["YES", "NO"],
};

// ─── Reading a staged value ─────────────────────────────────────────────────

export type Raw = string | number | boolean | null | undefined;
export type ReadError = "badDate" | "badNumber" | "badMonth" | "unmapped";
export interface Read {
  value: string | null;
  error?: ReadError;
  /** The old value, shown with the error. */
  raw?: string;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Dates as FoxPro programs wrote them: ISO, DD/MM/YYYY, DD-MM-YY, DD.MM.YYYY, YYYYMMDD, or "15 Aug 1990". */
export function parseOldDate(input: Raw): string | null | "invalid" {
  if (input === null || input === undefined || input === "") return null;
  const s = String(input).trim();
  if (!s || /^0+$/.test(s) || s === "/  /" || /^[\s/.-]+$/.test(s)) return null;
  if (isISODate(s.slice(0, 10)) && (s.length === 10 || s[10] === "T" || s[10] === " ")) return s.slice(0, 10);
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return isISODate(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : "invalid";
  m = s.match(/^(\d{1,2})[-/.\s](\d{1,2}|[A-Za-z]{3})[A-Za-z]*[-/.\s](\d{2}|\d{4})$/);
  if (!m) return "invalid";
  const mm = /^\d+$/.test(m[2]) ? Number(m[2]) : MONTHS.indexOf(m[2].toUpperCase()) + 1;
  // Two-digit years: 00–29 are this century, 30–99 the last (birth and joining dates of serving staff).
  const yy = m[3].length === 2 ? (Number(m[3]) < 30 ? 2000 : 1900) + Number(m[3]) : Number(m[3]);
  const iso = `${yy}-${String(mm).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return mm >= 1 && isISODate(iso) ? iso : "invalid";
}

/** Months: 2026-09, 09/2026, 9-2026, SEP-2026, 202609, or a date in the month. */
export function parseOldMonth(input: Raw): string | null | "invalid" {
  if (input === null || input === undefined || input === "") return null;
  const s = String(input).trim().toUpperCase();
  let m = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2].padStart(2, "0")}` : "invalid";
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${m[2]}-${m[1].padStart(2, "0")}` : "invalid";
  m = s.match(/^([A-Z]{3})[A-Z]*[-/.\s]?(\d{2}|\d{4})$/);
  if (m && MONTHS.includes(m[1])) return `${m[2].length === 2 ? 2000 + Number(m[2]) : m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0")}`;
  m = s.match(/^(\d{4})(\d{2})$/);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}` : "invalid";
  const d = parseOldDate(s);
  return d && d !== "invalid" ? d.slice(0, 7) : "invalid";
}

/** Amounts: numbers, or text with commas, ₹, "Rs." and spaces; a trailing "-" or brackets mean a negative figure. */
export function parseAmount(input: Raw): number | null | "invalid" {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : "invalid";
  let s = String(input).trim().replace(/₹|rs\.?|inr|,|\s/gi, "");
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s) || s.endsWith("-")) {
    sign = -1;
    s = s.replace(/[()]/g, "").replace(/-$/, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : "invalid";
}

/** "Rakesh Kumar Sharma" → first, middle, last (one word is a first name only). */
export function splitName(full: string): { firstName: string; middleName: string; lastName: string } {
  const parts = full.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", middleName: "", lastName: "" };
  return { firstName: parts[0], middleName: parts.slice(1, -1).join(" "), lastName: parts[parts.length - 1] };
}

export const cellOf = (row: { data: Record<string, Raw>; fixed?: Record<string, Raw> | null }, column: string): Raw =>
  row.fixed && Object.prototype.hasOwnProperty.call(row.fixed, column) ? row.fixed[column] : row.data[column];

/** One field of one row: the cleaned value if there is one, the constant when no column is mapped, then the rules above. */
export function readField(row: { data: Record<string, Raw>; fixed?: Record<string, Raw> | null }, def: FieldDef, map: FieldMap | undefined, codes: Codes, allowed?: readonly string[]): Read {
  let raw: Raw = map?.column ? cellOf(row, map.column) : (map?.constant ?? null);
  if (typeof raw === "string") raw = raw.trim();
  if (raw === null || raw === undefined || raw === "") return { value: null };
  let s = String(raw);
  if (map?.transform === "kruti") s = krutiToUnicode(s);
  if (map?.transform === "upper") s = s.toUpperCase();
  switch (def.kind) {
    case "date": {
      const d = parseOldDate(raw);
      return d === "invalid" ? { value: null, error: "badDate", raw: s } : { value: d };
    }
    case "month": {
      const m = parseOldMonth(raw);
      return m === "invalid" ? { value: null, error: "badMonth", raw: s } : { value: m };
    }
    case "money":
    case "number": {
      const n = parseAmount(raw);
      return n === "invalid" ? { value: null, error: "badNumber", raw: s } : { value: n === null ? null : String(n) };
    }
    case "code": {
      const mapped = def.list ? codes[def.list]?.[s] ?? codes[def.list]?.[s.toUpperCase()] : undefined;
      if (mapped) return { value: mapped };
      if (allowed?.includes(s.toUpperCase())) return { value: s.toUpperCase() };
      return { value: null, error: "unmapped", raw: s };
    }
    default:
      return { value: s };
  }
}

/** Rows the filter keeps (all when no filter is set). */
export function keepRow(row: { data: Record<string, Raw>; fixed?: Record<string, Raw> | null }, options: Options): boolean {
  if (!options.filterColumn || !options.filterValues?.trim()) return true;
  const wanted = options.filterValues.split(",").map((v) => v.trim().toUpperCase()).filter(Boolean);
  const v = cellOf(row, options.filterColumn);
  const s = v === true ? "T" : v === false ? "F" : String(v ?? "").trim().toUpperCase();
  return wanted.includes(s);
}
