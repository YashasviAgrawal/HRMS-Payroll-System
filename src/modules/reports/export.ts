import "server-only";
import ExcelJS from "exceljs";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateTime, formatMonth } from "@/lib/dates";
import { makeT, tDynamic } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/types";
import { embeddedFonts, logoDataUrl, renderPdf } from "@/lib/pdf";
import { cellText, colLabel, isNumeric, totalsOf } from "./present";
import { runReport, type RanReport } from "./registry";

/** S-70: every report to Excel (numbers stay numbers) and to PDF (A4, landscape when wide), in the login's language. */

const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const reportTitle = (t: ReturnType<typeof makeT>, no: number) => `${no}. ${tDynamic(t, `reports.titles.r${no}`)}`;

/** "October 2026 · Accounts · Permanent (NPS)" — what the figures cover. */
async function filterLine(ran: RanReport, t: ReturnType<typeof makeT>, locale: Locale) {
  const parts: string[] = [];
  if (ran.def.filters.includes("month")) parts.push(formatMonth(ran.filters.month, locale));
  if (ran.def.filters.includes("section")) {
    const s = ran.filters.sectionId ? await db.section.findUnique({ where: { id: ran.filters.sectionId }, select: { name: true, nameHi: true } }) : null;
    parts.push(s ? (locale === "hi" ? s.nameHi : s.name) : t("reports.allSections"));
  }
  if (ran.def.filters.includes("type")) parts.push(ran.filters.type ? tDynamic(t, `employees.type.${ran.filters.type}`) : t("reports.allTypes"));
  return parts.join(" · ");
}

const fileBase = (ran: RanReport) => `Report-${ran.def.no}-${ran.def.key}-${ran.filters.month}`;

async function excel(ran: RanReport, locale: Locale, actor: Actor) {
  const t = makeT(locale);
  const board = await db.board.findUniqueOrThrow({ where: { id: actor.boardId } });
  const { columns, rows, note } = ran.result;
  const wb = new ExcelJS.Workbook();
  wb.creator = "DCB HRMS";
  const ws = wb.addWorksheet(`Report ${ran.def.no}`, { views: [{ state: "frozen", ySplit: 5 }] });
  ws.addRow([locale === "hi" ? board.nameHi : board.name]).font = { bold: true, size: 13, color: { argb: "FF0F432E" } };
  ws.addRow([reportTitle(t, ran.def.no)]).font = { bold: true, size: 12 };
  ws.addRow([await filterLine(ran, t, locale)]).font = { color: { argb: "FF4F5D56" } };
  ws.addRow([note ? (locale === "hi" ? note.hi : note.en) : ""]).font = { italic: true, size: 9, color: { argb: "FF4F5D56" } };
  const head = ws.addRow(columns.map((c) => colLabel(c, t, locale)));
  head.font = { bold: true, color: { argb: "FF115136" } };
  head.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDFAF2" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FF9AA8A1" } } };
    cell.alignment = { wrapText: true, vertical: "top" };
  });
  const valueOf = (c: (typeof columns)[number], r: (typeof rows)[number]) => {
    const v = r[c.key];
    if (v === null || v === undefined || v === "") return null;
    if (isNumeric(c) && !c.enumKey) return Number(v);
    return cellText(c, r, t, locale);
  };
  for (const r of rows) {
    const row = ws.addRow(columns.map((c) => valueOf(c, r)));
    if (r._tone) row.eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: r._tone === "red" ? "FFFDECEC" : "FFFEF6E4" } }));
  }
  const totals = totalsOf(ran.result);
  if (totals) {
    const row = ws.addRow(columns.map((c, i) => (c.total ? Number(totals[c.key] ?? 0) : i === 0 ? t("reports.total") : null)));
    row.font = { bold: true };
    row.eachCell((cell) => (cell.border = { top: { style: "thin", color: { argb: "FF116541" } } }));
  }
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.kind === "money" && !c.enumKey) col.numFmt = "#,##0.00";
    const longest = Math.max(colLabel(c, t, locale).length, ...rows.slice(0, 300).map((r) => cellText(c, r, t, locale).length));
    col.width = Math.min(48, Math.max(/^d\d\d$/.test(c.key) ? 4 : 8, longest + 2));
  });
  ws.addRow([]);
  ws.addRow([`${t("reports.printedBy", { name: actor.name })} · ${formatDateTime(new Date(), locale)}`]).font = { size: 8, color: { argb: "FF6B7A72" } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function pdf(ran: RanReport, locale: Locale, actor: Actor) {
  const t = makeT(locale);
  const board = await db.board.findUniqueOrThrow({ where: { id: actor.boardId } });
  const { columns, rows, note, links } = ran.result;
  const landscape = columns.length > 7;
  const tiny = columns.length > 16;
  const logo = logoDataUrl();
  const totals = totalsOf(ran.result);
  const align = (c: (typeof columns)[number]) => (isNumeric(c) && !c.enumKey ? ' class="n"' : "");
  const tone = (r: (typeof rows)[number]) => (r._tone === "red" ? ' class="red"' : r._tone === "amber" ? ' class="amber"' : "");
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>
    ${embeddedFonts()}
    @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 11mm 10mm 13mm 10mm; }
    body { font-family: ${locale === "hi" ? "'Noto Sans Devanagari', 'Inter'" : "'Inter', 'Noto Sans Devanagari'"}, sans-serif; color: #17201b; font-size: ${tiny ? "6.4pt" : landscape ? "7.6pt" : "8.6pt"}; margin: 0; }
    header { display: flex; gap: 12px; align-items: center; border-bottom: 2px solid #116541; padding-bottom: 7px; }
    header img { width: 44px; height: 44px; }
    header h1 { margin: 0; font-size: 13pt; color: #0f432e; }
    header p { margin: 1px 0 0; color: #4f5d56; }
    .meta { margin: 7px 0 3px; font-weight: 600; color: #0f432e; }
    .note { margin: 0 0 8px; color: #4f5d56; font-size: 0.95em; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    th, td { border: 1px solid #d5ddd9; padding: ${tiny ? "2px 2px" : "3px 4px"}; text-align: left; vertical-align: top; }
    th { background: #edfaf2; color: #115136; font-weight: 600; }
    tr { page-break-inside: avoid; }
    .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .red td { background: #fdecec; } .amber td { background: #fef6e4; }
    .tot td { background: #e3f5ea; font-weight: 700; }
    .links { margin-top: 10px; font-size: 0.95em; color: #4f5d56; }
    footer { margin-top: 14px; display: flex; justify-content: space-between; font-size: 7pt; color: #6b7a72; }
  </style></head><body>
    <header>${logo ? `<img src="${logo}" alt="">` : ""}<div><h1>${esc(locale === "hi" ? board.nameHi : board.name)}</h1><p>${esc(reportTitle(t, ran.def.no))}</p></div></header>
    <p class="meta">${esc(await filterLine(ran, t, locale))}</p>
    ${note ? `<p class="note">${esc(locale === "hi" ? note.hi : note.en)}</p>` : ""}
    ${
      rows.length === 0
        ? `<p>${esc(t("reports.nothing"))}</p>`
        : `<table><thead><tr>${columns.map((c) => `<th${align(c)}>${esc(colLabel(c, t, locale))}</th>`).join("")}</tr></thead><tbody>
      ${rows.map((r) => `<tr${tone(r)}>${columns.map((c) => `<td${align(c)}>${esc(cellText(c, r, t, locale))}</td>`).join("")}</tr>`).join("")}
      ${totals ? `<tr class="tot">${columns.map((c, i) => `<td${align(c)}>${c.total ? esc(cellText(c, totals, t, locale)) : i === 0 ? esc(t("reports.total")) : ""}</td>`).join("")}</tr>` : ""}
    </tbody></table>`
    }
    ${links?.length ? `<p class="links">${esc(t("reports.alsoPrinted"))}: ${links.map((l) => esc(locale === "hi" ? l.labelHi : l.label)).join(" · ")}</p>` : ""}
    <footer><span>${esc(t("reports.printedBy", { name: actor.name }))} · ${esc(formatDateTime(new Date(), locale))}</span><span>DCB HRMS · ${esc(t("reports.rowsCount", { n: rows.length }))}</span></footer>
  </body></html>`;
  return renderPdf(html, { landscape });
}

/** Builds the file and records the print in the audit trail (PRD §11: every print is logged). */
export async function exportReport(actor: Actor, key: string, format: "xlsx" | "pdf", raw: { month?: string | null; section?: string | null; type?: string | null }, locale: Locale) {
  const ran = await runReport(actor, key, raw);
  const buffer = format === "xlsx" ? await excel(ran, locale, actor) : await pdf(ran, locale, actor);
  await audit(db, actor, {
    action: "PRINT",
    entityType: "Report",
    entityId: ran.def.key,
    summary: `Downloaded report ${ran.def.no} (${ran.def.key}) as ${format === "xlsx" ? "Excel" : "PDF"} for ${ran.filters.month}${ran.filters.sectionId ? `, one section` : ""}${ran.filters.type ? `, ${ran.filters.type}` : ""}`,
    newValue: { month: ran.filters.month, sectionId: ran.filters.sectionId, type: ran.filters.type, rows: ran.result.rows.length },
  });
  return {
    buffer,
    fileName: `${fileBase(ran)}.${format}`,
    mimeType: format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf",
  };
}
