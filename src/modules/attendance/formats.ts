/**
 * Reading punch files from biometric devices (AT-01). The exact export layouts at DCB are an open question
 * (PRD §18), so each format is described by the column headings it uses; headings are matched loosely
 * (case, spaces and punctuation ignored) and new aliases are one line each.
 *
 * Every row becomes { biometric ID, wall-clock date and time in India } or an error with its line number.
 */
import ExcelJS from "exceljs";
import { isISODate, istInstant, type ISODate } from "@/lib/dates";

export { FORMAT_DEFS, PUNCH_FORMATS, type PunchFormat } from "./format-defs";
import { FORMAT_DEFS, type PunchFormat } from "./format-defs";

export interface ParsedPunch {
  line: number;
  biometricId: string;
  date: ISODate;
  time: string;
  at: Date;
}

export interface ParseError {
  line: number;
  key: "attendance.import.badRow" | "attendance.import.badDate" | "attendance.import.badTime" | "attendance.import.noId";
  text: string;
}

export interface ParseResult {
  punches: ParsedPunch[];
  errors: ParseError[];
  /** True when no usable heading row was found. */
  unreadable: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Indian exports write the day first: 01-10-2026, 01/10/2026, 01.10.2026, 01-Oct-2026; ISO also accepted. */
export function parseDateText(text: string): ISODate | null {
  const s = text.trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return valid(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return valid(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3})[A-Za-z]*[-/. ,]+(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return valid(`${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  return null;
}

function valid(iso: string) {
  return isISODate(iso) ? iso : null;
}

/** 09:05, 9:05:33, 9.05, 09:05 AM, 9:05pm → "HH:MM". */
export function parseTimeText(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[4]) {
    const pm = m[4].toLowerCase() === "pm";
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (pm ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** "2026-10-01 09:05:33", "01/10/2026 9:05 AM", "01-10-2026T09:05" → date and time. */
export function parseDateTimeText(text: string): { date: ISODate; time: string } | null {
  const s = text.trim().replace("T", " ");
  const m = s.match(/^(\S+)\s+(.+)$/);
  if (!m) return null;
  const date = parseDateText(m[1]);
  const time = parseTimeText(m[2]);
  return date && time ? { date, time } : null;
}

type Cell = string | Date | number | null;

/** Excel keeps wall-clock values in a Date's UTC fields. */
function excelDate(d: Date): { date: ISODate | null; time: string | null } {
  const iso = d.toISOString();
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 16);
  // A time-only cell is a date on 30/31 Dec 1899.
  return { date: date < "1900-01-02" ? null : date, time: time === "00:00" && date >= "1900-01-02" ? null : time };
}

function cellString(c: Cell): string {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) return c.toISOString();
  return String(c).trim();
}

function dateOf(c: Cell): ISODate | null {
  if (c instanceof Date) return excelDate(c).date;
  return parseDateText(cellString(c)) ?? parseDateTimeText(cellString(c))?.date ?? null;
}

function timeOf(c: Cell): string | null {
  if (c instanceof Date) return excelDate(c).time ?? "00:00";
  if (typeof c === "number" && c >= 0 && c < 1) {
    const mins = Math.round(c * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }
  return parseTimeText(cellString(c)) ?? parseDateTimeText(cellString(c))?.time ?? null;
}

function dateTimeOf(c: Cell): { date: ISODate; time: string } | null {
  if (c instanceof Date) {
    const { date, time } = excelDate(c);
    return date ? { date, time: time ?? "00:00" } : null;
  }
  return parseDateTimeText(cellString(c));
}

/** Splits CSV / TSV / semicolon / pipe text, honouring quotes. */
export function splitDelimited(text: string): string[][] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const sample = lines.slice(0, 5).join("\n");
  const delimiter = ["\t", ",", ";", "|"].map((d) => [d, sample.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  return lines.map((line) => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delimiter) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

const ATTLOG_LINE = /^\s*([A-Za-z0-9]+)\t(\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(?::\d{2})?)/;

/** ZKTeco / eSSL attlog lines "PIN<TAB>YYYY-MM-DD HH:MM:SS<TAB>…" — also what devices send to the push endpoint. */
export function parseAttlog(text: string, firstLine = 1): ParseResult {
  const punches: ParsedPunch[] = [];
  const errors: ParseError[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return;
    const line = firstLine + i;
    const m = raw.match(ATTLOG_LINE);
    const dt = m ? parseDateTimeText(m[2]) : null;
    if (!m || !dt) errors.push({ line, key: "attendance.import.badRow", text: raw.slice(0, 80) });
    else punches.push({ line, biometricId: m[1], ...dt, at: istInstant(dt.date, dt.time) });
  });
  return { punches, errors, unreadable: punches.length === 0 && errors.length > 0 };
}

function findColumn(headings: string[], aliases: string[] | undefined): number {
  if (!aliases) return -1;
  for (const a of aliases) {
    const i = headings.indexOf(a);
    if (i >= 0) return i;
  }
  return -1;
}

/** Rows with headings (CSV or Excel) → punches, using the chosen format's column names. */
export function parseRows(rows: Cell[][], format: PunchFormat): ParseResult {
  const def = FORMAT_DEFS[format];
  // The heading row is the first one (within the first 10) that has an ID column.
  let headIndex = -1;
  let headings: string[] = [];
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const h = rows[i].map((c) => norm(cellString(c)));
    if (findColumn(h, def.id) >= 0) {
      headIndex = i;
      headings = h;
      break;
    }
  }
  if (headIndex < 0) return { punches: [], errors: [], unreadable: true };
  const col = {
    id: findColumn(headings, def.id),
    dateTime: findColumn(headings, def.dateTime),
    date: findColumn(headings, def.date),
    time: findColumn(headings, def.time),
    inTime: findColumn(headings, def.inTime),
    outTime: findColumn(headings, def.outTime),
  };
  const twoTimes = col.date >= 0 && (col.inTime >= 0 || col.outTime >= 0);
  const split = col.date >= 0 && col.time >= 0 && col.time !== col.date;
  if (col.dateTime < 0 && !split && !twoTimes) return { punches: [], errors: [], unreadable: true };

  const punches: ParsedPunch[] = [];
  const errors: ParseError[] = [];
  for (let i = headIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    if (r.every((c) => cellString(c) === "")) continue;
    const id = cellString(r[col.id] ?? null).replace(/\.0$/, "");
    const text = r.map(cellString).join(" · ").slice(0, 80);
    if (!id) {
      errors.push({ line, key: "attendance.import.noId", text });
      continue;
    }
    const push = (date: ISODate, time: string) => punches.push({ line, biometricId: id, date, time, at: istInstant(date, time) });
    if (twoTimes) {
      const date = dateOf(r[col.date] ?? null);
      if (!date) {
        errors.push({ line, key: "attendance.import.badDate", text });
        continue;
      }
      const times = [col.inTime, col.outTime].filter((c) => c >= 0).map((c) => cellString(r[c] ?? null) === "" ? null : timeOf(r[c] ?? null));
      const rawTimes = [col.inTime, col.outTime].filter((c) => c >= 0).map((c) => cellString(r[c] ?? null));
      if (times.some((t, k) => t === null && rawTimes[k] !== "" && !/^-+$|^na$/i.test(rawTimes[k]))) {
        errors.push({ line, key: "attendance.import.badTime", text });
        continue;
      }
      for (const t of times) if (t) push(date, t);
      continue;
    }
    if (split) {
      const date = dateOf(r[col.date] ?? null);
      const time = timeOf(r[col.time] ?? null);
      if (!date) errors.push({ line, key: "attendance.import.badDate", text });
      else if (!time) errors.push({ line, key: "attendance.import.badTime", text });
      else push(date, time);
      continue;
    }
    const dt = dateTimeOf(r[col.dateTime] ?? null);
    if (!dt) errors.push({ line, key: "attendance.import.badDate", text });
    else push(dt.date, dt.time);
  }
  return { punches, errors, unreadable: false };
}

/** Any supported file: .xlsx, .csv / .txt, or a ZKTeco attlog .dat. */
export async function parsePunchFile(buffer: Buffer, fileName: string, format: PunchFormat): Promise<ParseResult> {
  const isZip = buffer.subarray(0, 2).toString("latin1") === "PK";
  if (isZip) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      return { punches: [], errors: [], unreadable: true };
    }
    const sheet = wb.worksheets[0];
    if (!sheet) return { punches: [], errors: [], unreadable: true };
    const rows: Cell[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, n) => {
      const values: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        values[c - 1] = plainCell(cell.value);
      });
      rows[n - 1] = values;
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    return parseRows(rows, format);
  }
  const text = buffer.toString("utf8");
  const firstLines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 3);
  if (/\.dat$/i.test(fileName) || (firstLines.length > 0 && firstLines.every((l) => ATTLOG_LINE.test(l)))) return parseAttlog(text);
  return parseRows(splitDelimited(text), format);
}

function plainCell(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if ("result" in v) return plainCell(v.result as ExcelJS.CellValue);
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
  }
  return String(v);
}

/** The Board's own punch template (.xlsx) for offices that type punches in. */
export async function punchTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Punches");
  ws.columns = [
    { header: "Biometric ID", key: "id", width: 16 },
    { header: "Date", key: "date", width: 14 },
    { header: "Time", key: "time", width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.addRow({ id: "10003", date: "01-10-2026", time: "09:02" });
  ws.addRow({ id: "10003", date: "01-10-2026", time: "17:41" });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
