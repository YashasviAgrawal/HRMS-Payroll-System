import "server-only";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, toISODate } from "@/lib/dates";
import { forbidden, notFound } from "@/lib/errors";
import { amountInWords, formatINR } from "@/lib/money";
import { embeddedFonts, logoDataUrl, renderPdf } from "@/lib/pdf";
import type { Actor } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { fullName } from "@/modules/employees/present";
import { KIND_LABEL } from "@/modules/employees/separation";
import { canSeeSettlement, settlementView } from "./settlement";
import type { SeparationKind } from "./settlement-rules";

/**
 * Client add-on: the full and final settlement statement as a PDF, in both languages — the person, the leaving, every
 * due and every recovery with how it was worked out, the net, and who prepared, checked and approved it. For signature
 * and the personal file; a draft statement is marked as a draft.
 */
const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function settlementPdf(actor: Actor, id: string): Promise<{ pdf: Buffer; fileName: string }> {
  if (!canSeeSettlement(actor)) throw forbidden();
  const view = await settlementView(actor, id);
  if (!view) throw notFound();
  const sep = await db.separation.findUniqueOrThrow({ where: { id }, include: { employee: { include: { post: true, section: true } } } });
  const [board, tasks] = await Promise.all([
    db.board.findUniqueOrThrow({ where: { id: sep.boardId } }),
    db.approvalTask.findMany({ where: { boardId: sep.boardId, kind: "separation.settlement", entityId: sep.id, status: "APPROVED" }, orderBy: { decidedAt: "desc" }, take: 2 }),
  ]);
  const st = view.statement;
  const e = sep.employee;
  const kind = KIND_LABEL[sep.kind as SeparationKind];
  const checker = tasks.find((t) => (t.payload as { step?: string }).step !== "approver");
  const approver = tasks.find((t) => (t.payload as { step?: string }).step === "approver");
  const row = (en: string, hi: string, value: string) => `<tr><th>${en}<br><span lang="hi">${hi}</span></th><td>${value}</td></tr>`;
  const lineRows = (k: "DUE" | "RECOVERY") =>
    st.lines
      .filter((l) => l.kind === k)
      .map((l, i) => `<tr><td class="n">${i + 1}</td><td>${esc(l.label)}${l.labelHi !== l.label ? `<br><span lang="hi">${esc(l.labelHi)}</span>` : ""}${l.note ? `<div class="note">${esc(l.note)}</div>` : ""}</td><td class="amt">${esc(formatINR(l.amount))}</td></tr>`)
      .join("") || `<tr><td class="n">—</td><td>Nil · <span lang="hi">शून्य</span></td><td class="amt">${esc(formatINR(0))}</td></tr>`;
  const t = st.totals;
  const net = t.toRecover > 0 ? `To be paid back by the employee · <span lang="hi">कर्मचारी से वसूली योग्य</span>: <b>${esc(formatINR(t.toRecover))}</b> (${esc(amountInWords(t.toRecover))})` : `Net payable · <span lang="hi">शुद्ध देय</span>: <b>${esc(formatINR(t.payable))}</b> (${esc(amountInWords(t.payable))})`;
  const logo = logoDataUrl();
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    ${embeddedFonts()}
    @page { size: A4; margin: 14mm; }
    body { font-family: 'Inter', 'Noto Sans Devanagari', sans-serif; color: #17201b; font-size: 9pt; margin: 0; }
    [lang="hi"] { font-family: 'Noto Sans Devanagari', 'Inter', sans-serif; }
    header { display: flex; gap: 12px; align-items: center; border-bottom: 2px solid #116541; padding-bottom: 8px; }
    header img { height: 70px; width: auto; } header h1 { margin: 0; font-size: 14pt; color: #0f432e; } header p { margin: 2px 0 0; color: #4f5d56; }
    .draft { margin: 10px 0; padding: 6px 10px; border: 1.5px solid #b45309; border-radius: 6px; color: #92400e; background: #fffbeb; font-weight: 600; }
    h2 { font-size: 10pt; color: #0f432e; margin: 12px 0 4px; }
    table { width: 100%; border-collapse: collapse; } tr { break-inside: avoid; page-break-inside: avoid; }
    th, td { border: 1px solid #d5ddd9; padding: 4px 7px; text-align: left; vertical-align: top; }
    .facts th { width: 32%; background: #f6faf8; color: #115136; font-weight: 600; } th span { font-weight: 400; color: #4f5d56; }
    .lines th { background: #f6faf8; color: #115136; } td.n { width: 22px; text-align: center; color: #56645d; } td.amt, th.amt { width: 110px; text-align: right; white-space: nowrap; }
    .note { font-size: 7.5pt; color: #56645d; margin-top: 1px; }
    .total td { font-weight: 600; background: #f6faf8; }
    .net { margin-top: 12px; padding: 8px 12px; border: 1.5px solid #116541; border-radius: 8px; background: #edfaf2; font-size: 10pt; }
    .info { margin-top: 8px; font-size: 8pt; color: #4f5d56; }
    .signs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 34px; font-size: 8.5pt; break-inside: avoid; }
    .signs div { border-top: 1px solid #9aa8a1; padding-top: 4px; }
    footer { margin-top: 16px; font-size: 7.5pt; color: #56645d; }
  </style></head><body>
    <header>${logo ? `<img src="${logo}" alt="">` : ""}<div><h1>${esc(board.name)} · <span lang="hi">${esc(board.nameHi)}</span></h1><p>Full and final settlement · <span lang="hi">अंतिम निपटान विवरण</span></p></div></header>
    ${view.frozen ? "" : `<div class="draft">Draft — not yet checked or approved · <span lang="hi">प्रारूप — अभी जाँचा या स्वीकृत नहीं</span></div>`}
    <h2>The employee and the leaving · <span lang="hi">कर्मचारी और सेवा छोड़ना</span></h2>
    <table class="facts">
      ${row("Name and Employee ID", "नाम और कर्मचारी आईडी", `<b>${esc(fullName(e))}</b>${e.nameHi ? ` · <span lang="hi">${esc(e.nameHi)}</span>` : ""} · ${esc(e.employeeCode)}`)}
      ${row("Post and section", "पद और अनुभाग", `${esc(e.post.name)} — ${esc(e.section.name)}`)}
      ${row("Date of joining", "कार्यग्रहण तिथि", esc(formatDate(toISODate(e.dateOfJoining))))}
      ${row("Leaving", "सेवा छोड़ना", `${esc(kind[0])} · <span lang="hi">${esc(kind[1])}</span>`)}
      ${row("Last day of service", "सेवा का अंतिम दिन", esc(formatDate(st.lastDay)))}
      ${row("Order", "आदेश", `${esc(sep.orderNumber)} dated ${esc(formatDate(toISODate(sep.orderDate)))}`)}
    </table>
    <h2>A. Dues · <span lang="hi">क. देय राशि</span></h2>
    <table class="lines"><tr><th>#</th><th>Item · <span lang="hi">मद</span></th><th class="amt">Amount · <span lang="hi">राशि</span></th></tr>${lineRows("DUE")}<tr class="total"><td></td><td>Total dues · <span lang="hi">कुल देय</span></td><td class="amt">${esc(formatINR(t.dues))}</td></tr></table>
    <h2>B. Recoveries · <span lang="hi">ख. वसूली</span></h2>
    <table class="lines"><tr><th>#</th><th>Item · <span lang="hi">मद</span></th><th class="amt">Amount · <span lang="hi">राशि</span></th></tr>${lineRows("RECOVERY")}<tr class="total"><td></td><td>Total recoveries · <span lang="hi">कुल वसूली</span></td><td class="amt">${esc(formatINR(t.recoveries))}</td></tr></table>
    <div class="net">${net}</div>
    <div class="info">
      ${st.gpf ? `GPF final payment ${esc(formatINR(st.gpf.total))} (balance ${esc(formatINR(st.gpf.balance))} + interest ${esc(formatINR(st.gpf.interest))}) is paid from the GPF fund, not this statement${st.gpf.advanceLeft ? `; GPF advance not paid back (${esc(formatINR(st.gpf.advanceLeft))}) is already taken off the balance` : ""}. · <span lang="hi">जीपीएफ अंतिम भुगतान जीपीएफ निधि से होगा।</span><br>` : ""}
      ${st.nps ? `NPS: the exit request goes to the CRA; the NPS account is not part of this statement. · <span lang="hi">एनपीएस: निकासी अनुरोध सीआरए को भेजा जाएगा।</span><br>` : ""}
      Worked out on ${esc(formatDate(st.workedOn))}; loan interest to ${esc(st.month)}.
    </div>
    <div class="signs">
      <div>Prepared by / तैयारकर्ता<br><b>${esc(checker?.makerName ?? approver?.makerName ?? "")}</b></div>
      <div>Checked by / जाँचकर्ता<br><b>${esc(checker?.deciderName ?? "")}</b></div>
      <div>Approved by / स्वीकृतकर्ता<br><b>${esc(approver?.deciderName ?? "")}</b></div>
      <div>Received by the employee / कर्मचारी द्वारा प्राप्त<br><br></div>
    </div>
    <footer>Generated by DCB HRMS on ${esc(formatDateTime(new Date()))}.</footer>
  </body></html>`;
  await audit(db, actor, { action: "EXPORT", entityType: "Separation", entityId: id, summary: `Settlement statement PDF of ${fullName(e)}`, sensitive: true });
  return { pdf: await renderPdf(html), fileName: `settlement-${e.employeeCode ?? e.id}.pdf` };
}
