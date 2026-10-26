import "server-only";
import { formatDateTime } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { embeddedFonts, logoDataUrl } from "@/lib/pdf";

/** Shared page for the statutory PDFs (GPF statement, Form 16 Part B) — the same look as the pay bill and payslip. */
export const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export const rs = (n: number) => formatINR(n, { symbol: false });

export function statPage(opts: { title: string; subtitle?: string; meta: [string, string][]; body: string; footer?: string }) {
  const logo = logoDataUrl();
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${embeddedFonts()}
    @page { size: A4; margin: 12mm 12mm 14mm 12mm; }
    body { font-family: 'Inter', 'Noto Sans Devanagari', sans-serif; color: #17201b; font-size: 9pt; margin: 0; }
    header { display: flex; gap: 12px; align-items: center; border-bottom: 2px solid #116541; padding-bottom: 8px; }
    header img { width: 48px; height: 48px; }
    header h1 { margin: 0; font-size: 13.5pt; color: #0f432e; }
    header p { margin: 1px 0 0; color: #4f5d56; }
    .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 22px; margin: 10px 0; }
    .meta b { color: #0f432e; }
    h2 { font-size: 10.5pt; margin: 14px 0 5px; color: #0f432e; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d5ddd9; padding: 3px 6px; text-align: left; vertical-align: top; }
    th { background: #edfaf2; color: #115136; font-weight: 600; }
    tr { page-break-inside: avoid; }
    .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .tot td { background: #e3f5ea; font-weight: 700; } .sub td { background: #f6faf8; }
    .muted { color: #6b7a72; } .small { font-size: 8pt; }
    .keep { break-inside: avoid; page-break-inside: avoid; }
    .sign { margin-top: 26px; display: flex; justify-content: flex-end; } .sign div { min-width: 220px; border-top: 1px solid #9aa8a1; padding-top: 4px; font-size: 8.5pt; }
    footer { margin-top: 18px; display: flex; justify-content: space-between; font-size: 7.5pt; color: #6b7a72; }
  </style></head><body>
    <header>${logo ? `<img src="${logo}" alt="">` : ""}<div><h1>${esc(opts.title)}</h1>${opts.subtitle ? `<p>${esc(opts.subtitle)}</p>` : ""}</div></header>
    <div class="meta">${opts.meta.map(([k, v]) => `<span>${esc(k)}: <b>${esc(v)}</b></span>`).join("")}</div>
    ${opts.body}
    <footer><span>${esc(opts.footer ?? "Computer-generated; DCB HRMS")}</span><span>${esc(formatDateTime(new Date()))}</span></footer>
  </body></html>`;
}
