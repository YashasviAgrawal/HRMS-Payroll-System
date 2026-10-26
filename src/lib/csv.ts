/** Minimal RFC 4180 CSV writer (Excel-friendly: UTF-8 BOM so Hindi opens correctly). */
export function toCsv(columns: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [columns, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** dd/mm/yyyy, the date format government portals expect. */
export function portalDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
