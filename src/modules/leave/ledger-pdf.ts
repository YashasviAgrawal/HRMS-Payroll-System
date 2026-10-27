import "server-only";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, todayIST } from "@/lib/dates";
import { embeddedFonts, logoDataUrl, renderPdf } from "@/lib/pdf";
import { fullName } from "@/modules/employees/present";
import { employeeLeave } from "./service";

const esc = (s: string | null | undefined) => (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const KIND: Record<string, [string, string]> = {
  OPENING: ["Opening", "प्रारंभिक"],
  CREDIT: ["Credit", "जमा"],
  DEBIT: ["Leave taken", "लिया गया"],
  LAPSE: ["Lapsed", "व्यपगत"],
  REVERSAL: ["Restored", "वापस"],
};

/** LV-07: the leave account, printable for the service book (Hindi and English headings). */
export async function leaveLedgerPdf(actor: Actor, employeeId: string) {
  const data = await employeeLeave(actor, employeeId);
  const board = await db.board.findUniqueOrThrow({ where: { id: actor.boardId } });
  const e = data.employee;
  const logo = logoDataUrl();
  const codes = [...new Set(data.lines.map((l) => l.code))].sort((a, b) => data.types.findIndex((t) => t.code === a) - data.types.findIndex((t) => t.code === b));
  const sections = codes
    .map((code) => {
      const t = data.types.find((x) => x.code === code);
      const lines = data.lines.filter((l) => l.code === code);
      return `
      <h2>${esc(t?.name ?? code)} <span lang="hi">${esc(t?.nameHi ?? "")}</span> <small>(${esc(code)})</small></h2>
      <table>
        <thead><tr><th>Date / तारीख</th><th>Entry / प्रविष्टि</th><th>Details / विवरण</th><th class="n">Credit / जमा</th><th class="n">Debit / नामे</th><th class="n">Balance / शेष</th></tr></thead>
        <tbody>${lines
          .map(
            (l) => `<tr><td>${formatDate(l.date)}</td><td>${KIND[l.kind][0]} / <span lang="hi">${KIND[l.kind][1]}</span></td><td>${esc(l.note)}</td><td class="n">${l.days > 0 ? num(l.days) : ""}</td><td class="n">${l.days < 0 ? num(-l.days) : ""}</td><td class="n b">${num(l.balance)}</td></tr>`,
          )
          .join("")}</tbody>
      </table>`;
    })
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    ${embeddedFonts()}
    @page { size: A4; margin: 14mm 16mm 16mm 14mm; }
    body { font-family: 'Inter', 'Noto Sans Devanagari', sans-serif; color: #17201b; font-size: 9.5pt; margin: 0; }
    [lang="hi"] { font-family: 'Noto Sans Devanagari', 'Inter', sans-serif; }
    header { display: flex; gap: 14px; align-items: center; border-bottom: 2px solid #116541; padding-bottom: 10px; }
    header img { width: 54px; height: 54px; }
    header h1 { margin: 0; font-size: 15pt; color: #0f432e; }
    header p { margin: 0; color: #4f5d56; }
    .who { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 18px; margin: 12px 0 6px; font-size: 9.5pt; }
    .who b { color: #0f432e; }
    h2 { font-size: 11pt; margin: 16px 0 6px; color: #0f432e; } h2 small { color: #56645d; font-weight: 500; }
    table { width: 100%; border-collapse: collapse; page-break-inside: auto; table-layout: fixed; }
    th:nth-child(1) { width: 14%; } th:nth-child(2) { width: 17%; } th:nth-child(3) { width: 36%; } th:nth-child(4), th:nth-child(5), th:nth-child(6) { width: 11%; }
    td:first-child { white-space: nowrap; }
    th, td { border: 1px solid #d5ddd9; padding: 4px 6px; text-align: left; vertical-align: top; }
    th { background: #edfaf2; font-size: 8.5pt; color: #115136; }
    tr { page-break-inside: avoid; }
    .n { text-align: right; font-variant-numeric: tabular-nums; } .b { font-weight: 600; }
    footer { margin-top: 26px; display: flex; justify-content: space-between; font-size: 8.5pt; color: #56645d; }
    .sign { margin-top: 40px; text-align: right; font-weight: 600; }
  </style></head><body>
    <header>${logo ? `<img src="${logo}" alt="">` : ""}<div><h1>${esc(board.name)} · <span lang="hi">${esc(board.nameHi)}</span></h1><p>Leave account · <span lang="hi">अवकाश लेखा</span></p></div></header>
    <div class="who">
      <div>Employee / कर्मचारी: <b>${esc(fullName(e))}</b>${e.nameHi ? ` <span lang="hi">(${esc(e.nameHi)})</span>` : ""}</div>
      <div>Employee ID: <b>${esc(e.employeeCode)}</b></div>
      <div>Post / पद: <b>${esc(e.post.name)}</b></div>
      <div>Section / अनुभाग: <b>${esc(e.section.name)}</b></div>
      <div>Balances on / शेष दिनांक: <b>${formatDate(todayIST())}</b></div>
      <div>${data.balances.filter((b) => b.balance !== null && b.creditMode !== "SPELL").map((b) => `${b.code} <b>${num(b.balance!)}</b>`).join(" · ")}</div>
    </div>
    ${sections || "<p>No entries yet. / अभी कोई प्रविष्टि नहीं।</p>"}
    <div class="sign">Head Clerk / Office Superintendent<br><span lang="hi">प्रधान लिपिक / कार्यालय अधीक्षक</span></div>
    <footer><span>Printed ${formatDateTime(new Date())} by ${esc(actor.name)}</span><span>DCB HRMS</span></footer>
  </body></html>`;
  const pdf = await renderPdf(html);
  await audit(db, actor, { action: "PRINT", entityType: "LeaveLedger", entityId: employeeId, summary: `Printed the leave account of ${fullName(e)}` });
  return { pdf, fileName: `Leave-account-${e.employeeCode}.pdf` };
}
