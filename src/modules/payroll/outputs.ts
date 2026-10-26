import "server-only";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, formatMonth, toISODate } from "@/lib/dates";
import { forbidden, notFound } from "@/lib/errors";
import { amountInWords, formatINR } from "@/lib/money";
import { embeddedFonts, logoDataUrl, renderPdf } from "@/lib/pdf";
import { fullName } from "@/modules/employees/present";
import type { PayLine } from "./engine";
import { runTitle, type RunGroup } from "./compute";

/**
 * PR-11: pay bill, salary register, schedules of deductions and acquittance roll, printed from the run.
 * Layouts follow the usual Cantonment Board bill (CBAR 2020): abstract by head with account heads, the
 * register by section, one schedule per recovery head, and the acquittance roll by section. Final layouts are
 * to be matched to DCB's printed formats before go-live (PRD §18). Until the run is approved every page carries
 * a "DRAFT — not approved" band.
 */
export const PRINT_DOCS = ["paybill", "register", "schedules", "acquittance"] as const;
export type PrintDoc = (typeof PRINT_DOCS)[number];

const DOC_TITLE: Record<PrintDoc, [string, string]> = {
  paybill: ["Pay bill", "वेतन बिल"],
  register: ["Salary register", "वेतन रजिस्टर"],
  schedules: ["Schedules of deductions", "कटौतियों की अनुसूचियाँ"],
  acquittance: ["Acquittance roll", "भुगतान पावती पंजी"],
};

const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const rs = (n: number) => formatINR(n, { symbol: false });
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

async function load(actor: Actor, runId: string) {
  if (!canAll(actor, "payroll", "view")) throw forbidden();
  const run = await db.payrollRun.findFirst({ where: { id: runId, boardId: actor.boardId } });
  if (!run) throw notFound();
  const [board, slips, sections, heads] = await Promise.all([
    db.board.findUniqueOrThrow({ where: { id: actor.boardId } }),
    db.payslip.findMany({
      where: { runId },
      include: { employee: { select: { employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, pran: true, gpfNumber: true, uan: true, esicNumber: true, post: { select: { name: true, nameHi: true } } } } },
    }),
    db.section.findMany({ where: { boardId: actor.boardId }, select: { id: true, name: true, nameHi: true } }),
    db.payHead.findMany({ where: { boardId: actor.boardId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
  ]);
  const sectionBy = new Map(sections.map((s) => [s.id, s]));
  const people = slips
    .map((s) => ({
      code: s.employee.employeeCode ?? "",
      name: fullName(s.employee),
      nameHi: s.employee.nameHi,
      post: s.employee.post.name,
      ids: { NPS: s.employee.pran, NPS_ER: s.employee.pran, GPF: s.employee.gpfNumber, EPF: s.employee.uan, EPF_ER: s.employee.uan, ESIC: s.employee.esicNumber, ESIC_ER: s.employee.esicNumber } as Record<string, string | null>,
      sectionId: s.sectionId,
      section: sectionBy.get(s.sectionId)?.name ?? "",
      level: s.payLevel ? `L${s.payLevel}${s.payCell ? `/C${s.payCell}` : ""}` : "—",
      status: s.status,
      daysOnRoll: num(s.daysOnRoll),
      lossDays: num(s.lossDays),
      halfPayDays: num(s.halfPayDays),
      lines: s.lines as unknown as PayLine[],
      gross: num(s.gross),
      deductions: num(s.deductions),
      net: num(s.net),
      bankLast4: s.bankLast4,
      creditStatus: s.creditStatus,
    }))
    .sort((a, b) => a.section.localeCompare(b.section) || a.code.localeCompare(b.code));
  return { run, board, people, heads };
}

type Loaded = Awaited<ReturnType<typeof load>>;

function page(d: Loaded, doc: PrintDoc, body: string, actor: Actor, landscape = false) {
  const { run, board } = d;
  const logo = logoDataUrl();
  const approved = run.approvedAt !== null;
  const billNo = `PB/${run.month}/${run.payGroup}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${embeddedFonts()}
    @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 12mm 12mm 14mm 12mm; }
    body { font-family: 'Inter', 'Noto Sans Devanagari', sans-serif; color: #17201b; font-size: ${landscape ? "7.6pt" : "9pt"}; margin: 0; }
    [lang="hi"] { font-family: 'Noto Sans Devanagari', 'Inter', sans-serif; }
    header { display: flex; gap: 12px; align-items: center; border-bottom: 2px solid #116541; padding-bottom: 8px; }
    header img { width: 48px; height: 48px; }
    header h1 { margin: 0; font-size: 13.5pt; color: #0f432e; }
    header p { margin: 1px 0 0; color: #4f5d56; }
    .meta { display: flex; flex-wrap: wrap; gap: 4px 22px; margin: 8px 0 10px; }
    .meta b { color: #0f432e; }
    .draft { margin: 6px 0; padding: 5px 8px; border: 1.5px dashed #b45309; color: #92400e; font-weight: 700; text-align: center; letter-spacing: .04em; }
    h2 { font-size: 10.5pt; margin: 14px 0 5px; color: #0f432e; }
    table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
    th, td { border: 1px solid #d5ddd9; padding: 3px 5px; text-align: left; vertical-align: top; }
    th { background: #edfaf2; color: #115136; font-weight: 600; }
    tr { page-break-inside: avoid; }
    .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .b { font-weight: 700; } .sub td { background: #f6faf8; font-weight: 600; } .tot td { background: #e3f5ea; font-weight: 700; }
    .muted { color: #6b7a72; } .small { font-size: 8pt; }
    .words { margin: 8px 0; font-weight: 600; }
    .certs { margin-top: 12px; font-size: 8.5pt; } .certs li { margin: 3px 0; }
    .signs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 28px; font-size: 8.5pt; }
    .signs div { border-top: 1px solid #9aa8a1; padding-top: 4px; }
    .break { page-break-before: always; }
    .keep { break-inside: avoid; page-break-inside: avoid; }
    footer { margin-top: 18px; display: flex; justify-content: space-between; font-size: 7.5pt; color: #6b7a72; }
  </style></head><body>
    <header>${logo ? `<img src="${logo}" alt="">` : ""}<div><h1>${esc(board.name)} · <span lang="hi">${esc(board.nameHi)}</span></h1><p>${DOC_TITLE[doc][0]} · <span lang="hi">${DOC_TITLE[doc][1]}</span> — ${esc(runTitle(run.payGroup as RunGroup, run.month))}</p></div></header>
    <div class="meta">
      <span>Bill no. / बिल सं.: <b>${esc(billNo)}</b></span>
      <span>Month / माह: <b>${esc(formatMonth(run.month))}</b></span>
      <span>Version: <b>${run.version}</b></span>
      ${approved ? `<span>Approved and signed with OTP by <b>${esc(run.approvedByName)}</b> on <b>${esc(formatDateTime(run.approvedAt!))}</b></span>` : ""}
    </div>
    ${approved ? "" : `<div class="draft">DRAFT — NOT APPROVED · <span lang="hi">प्रारूप — स्वीकृत नहीं</span></div>`}
    ${body}
    <footer><span>Printed ${esc(formatDateTime(new Date()))} by ${esc(actor.name)}</span><span>DCB HRMS · ${esc(billNo)}</span></footer>
  </body></html>`;
}

/** Totals by head over the people paid, in pay-head order. */
function headTotals(d: Loaded) {
  const totals = new Map<string, { line: PayLine; amount: number }>();
  for (const p of d.people) {
    if (p.status !== "INCLUDED") continue;
    for (const l of p.lines) {
      const t = totals.get(l.code) ?? { line: l, amount: 0 };
      t.amount += l.amount;
      totals.set(l.code, t);
    }
  }
  const order = new Map(d.heads.map((h, i) => [h.code, i]));
  return [...totals.values()].sort((a, b) => (order.get(a.line.code) ?? 99) - (order.get(b.line.code) ?? 99));
}

function payBill(d: Loaded) {
  const totals = headTotals(d);
  const paid = d.people.filter((p) => p.status === "INCLUDED");
  const withheld = d.people.filter((p) => p.status === "WITHHELD");
  const sum = (kind: string) => totals.filter((t) => t.line.kind === kind).reduce((s, t) => s + t.amount, 0);
  const table = (kind: string, label: string, labelHi: string) => {
    const rows = totals.filter((t) => t.line.kind === kind);
    if (!rows.length) return "";
    return `<h2>${label} · <span lang="hi">${labelHi}</span></h2>
      <table><thead><tr><th style="width:10%">Code</th><th>Head / मद</th><th style="width:38%">Account head / लेखा शीर्ष</th><th class="n" style="width:16%">Amount (₹)</th></tr></thead><tbody>
      ${rows.map((t) => `<tr><td>${esc(t.line.code)}</td><td>${esc(t.line.name)} <span lang="hi" class="muted">${esc(t.line.nameHi)}</span></td><td>${esc(t.line.accountHead)}</td><td class="n">${rs(t.amount)}</td></tr>`).join("")}
      <tr class="tot"><td colspan="3">Total ${label.toLowerCase()}</td><td class="n">${rs(sum(kind))}</td></tr></tbody></table>`;
  };
  const gross = sum("EARNING");
  const ded = sum("DEDUCTION");
  const net = gross - ded;
  return `
    <div class="meta"><span>People paid / भुगतान: <b>${paid.length}</b></span><span>Pay withheld / रोका गया: <b>${withheld.length}</b></span></div>
    ${table("EARNING", "Earnings", "आय")}
    ${table("DEDUCTION", "Deductions", "कटौतियाँ")}
    <table style="margin-top:10px"><tbody>
      <tr class="tot"><td>Gross / सकल</td><td class="n">${rs(gross)}</td><td>Deductions / कटौतियाँ</td><td class="n">${rs(ded)}</td><td>Net payable / शुद्ध देय</td><td class="n">${rs(net)}</td></tr>
    </tbody></table>
    <p class="words">Net payable: ${esc(amountInWords(net))}<br><span lang="hi">${esc(amountInWords(net, "hi"))}</span></p>
    ${table("EMPLOYER", "Employer contributions (memo)", "नियोक्ता अंशदान (ज्ञापन)")}
    <div class="keep"><ol class="certs">
      <li>Certified that the pay and allowances drawn in this bill are according to the sanctioned rates and rules in force (CBAR 2020).</li>
      <li>Certified that all appointments, promotions and increments included in this bill are approved and entered in the service books.</li>
      <li>Certified that deductions shown have been made and will be credited to the heads concerned; pay of persons on leave or not on duty has been drawn only as admissible.</li>
      <li>Certified that net pay will be credited to the bank accounts of the payees through the bank file; no payment is made in cash.</li>
    </ol>
    <div class="signs">
      <div>Prepared by / तैयारकर्ता<br><b>${esc(d.run.runByName)}</b></div>
      <div>Checked by / जाँचकर्ता<br><b>${esc(d.run.checkedByName ?? "")}</b></div>
      <div>Approved and signed (OTP)<br><b>${esc(d.run.approvedByName ?? "")}</b>${d.run.approvedAt ? `<br>${esc(formatDate(toISODate(d.run.approvedAt)))}` : ""}</div>
      <div>Drawing and Disbursing Officer<br><span lang="hi">आहरण एवं संवितरण अधिकारी</span></div>
    </div></div>`;
}

function register(d: Loaded) {
  const totals = headTotals(d);
  const earn = totals.filter((t) => t.line.kind === "EARNING").map((t) => t.line);
  const ded = totals.filter((t) => t.line.kind === "DEDUCTION").map((t) => t.line);
  const paid = d.people.filter((p) => p.status === "INCLUDED");
  const amount = (p: (typeof paid)[number], code: string) => p.lines.find((l) => l.code === code)?.amount ?? 0;
  const row = (cells: string[], cls = "") => `<tr class="${cls}">${cells.join("")}</tr>`;
  const blankZero = (n: number) => (n ? rs(n) : "");
  const sumRow = (list: typeof paid, label: string, cls: string) =>
    row(
      [
        `<td colspan="4">${esc(label)}</td>`,
        ...earn.map((h) => `<td class="n">${blankZero(list.reduce((s, p) => s + amount(p, h.code), 0))}</td>`),
        `<td class="n">${rs(list.reduce((s, p) => s + p.gross, 0))}</td>`,
        ...ded.map((h) => `<td class="n">${blankZero(list.reduce((s, p) => s + amount(p, h.code), 0))}</td>`),
        `<td class="n">${rs(list.reduce((s, p) => s + p.deductions, 0))}</td>`,
        `<td class="n">${rs(list.reduce((s, p) => s + p.net, 0))}</td>`,
      ],
      cls,
    );
  const bySection = new Map<string, typeof paid>();
  for (const p of paid) bySection.set(p.section, [...(bySection.get(p.section) ?? []), p]);
  let n = 0;
  const body = [...bySection.entries()]
    .map(
      ([section, list]) =>
        row([`<td colspan="${6 + earn.length + ded.length}" class="b">${esc(section)}</td>`]) +
        list
          .map((p) =>
            row([
              `<td>${++n}</td>`,
              `<td><b>${esc(p.code)}</b><br>${esc(p.name)}</td>`,
              `<td>${esc(p.post)}<br><span class="muted">${esc(p.level)}</span></td>`,
              `<td class="n">${p.daysOnRoll}${p.lossDays ? `<br><span class="muted">−${p.lossDays}</span>` : ""}${p.halfPayDays ? `<br><span class="muted">½ ${p.halfPayDays}</span>` : ""}</td>`,
              ...earn.map((h) => `<td class="n">${amount(p, h.code) ? rs(amount(p, h.code)) : ""}</td>`),
              `<td class="n b">${rs(p.gross)}</td>`,
              ...ded.map((h) => `<td class="n">${amount(p, h.code) ? rs(amount(p, h.code)) : ""}</td>`),
              `<td class="n b">${rs(p.deductions)}</td>`,
              `<td class="n b">${rs(p.net)}</td>`,
            ]),
          )
          .join("") +
        sumRow(list, `Section total — ${section}`, "sub"),
    )
    .join("");
  return `<table><thead><tr><th>#</th><th>Employee</th><th>Post / level</th><th class="n">Days</th>${earn.map((h) => `<th class="n">${esc(h.code)}</th>`).join("")}<th class="n">Gross</th>${ded.map((h) => `<th class="n">${esc(h.code)}</th>`).join("")}<th class="n">Total ded.</th><th class="n">Net</th></tr></thead>
    <tbody>${body}${sumRow(paid, "Grand total / कुल योग", "tot")}</tbody></table>
    <p class="small muted">Days: on the rolls this month; − loss days (dies-non and no-pay leave) and ½ half-pay leave from last month's locked attendance.</p>`;
}

function schedules(d: Loaded) {
  const totals = headTotals(d).filter((t) => t.line.kind !== "EARNING");
  const paid = d.people.filter((p) => p.status === "INCLUDED");
  if (!totals.length) return "<p>No deductions in this bill.</p>";
  return totals
    .map((t, i) => {
      const list = paid.map((p) => ({ p, amount: p.lines.find((l) => l.code === t.line.code)?.amount ?? 0 })).filter((x) => x.amount);
      const idCol = ["NPS", "NPS_ER", "GPF", "EPF", "EPF_ER", "ESIC", "ESIC_ER"].includes(t.line.code);
      return `<div class="${i ? "break" : ""}">
        <h2>Schedule ${i + 1}: ${esc(t.line.name)} (${esc(t.line.code)}) · <span lang="hi">${esc(t.line.nameHi)}</span></h2>
        <p class="muted small">Account head: ${esc(t.line.accountHead)}${t.line.kind === "EMPLOYER" ? " — employer contribution" : ""}</p>
        <table><thead><tr><th style="width:6%">#</th><th style="width:13%">Employee ID</th><th>Name</th><th>Post</th>${idCol ? "<th>Account / PRAN / UAN</th>" : ""}<th class="n" style="width:15%">Amount (₹)</th></tr></thead><tbody>
        ${list.map((x, j) => `<tr><td>${j + 1}</td><td>${esc(x.p.code)}</td><td>${esc(x.p.name)}</td><td>${esc(x.p.post)}</td>${idCol ? `<td>${esc(x.p.ids[t.line.code] ?? "—")}</td>` : ""}<td class="n">${rs(x.amount)}</td></tr>`).join("")}
        <tr class="tot"><td colspan="${idCol ? 5 : 4}">Total (${list.length})</td><td class="n">${rs(t.amount)}</td></tr></tbody></table>
        <p class="words small">${esc(amountInWords(t.amount))}</p></div>`;
    })
    .join("");
}

function acquittance(d: Loaded) {
  const paid = d.people.filter((p) => p.status === "INCLUDED");
  const bySection = new Map<string, typeof paid>();
  for (const p of paid) bySection.set(p.section, [...(bySection.get(p.section) ?? []), p]);
  let n = 0;
  const credit = (s: string | null) => (s === "CREDITED" ? "Credited" : s === "FAILED" ? "Failed — re-pay" : s === "REPAID" ? "Re-paid" : "By bank transfer");
  const body = [...bySection.entries()]
    .map(
      ([section, list]) =>
        `<tr><td colspan="7" class="b">${esc(section)}</td></tr>` +
        list.map((p) => `<tr><td>${++n}</td><td>${esc(p.code)}</td><td>${esc(p.name)}${p.nameHi ? ` <span lang="hi" class="muted">${esc(p.nameHi)}</span>` : ""}</td><td>${esc(p.post)}</td><td>••••${esc(p.bankLast4 ?? "")}</td><td class="n">${rs(p.net)}</td><td>${credit(p.creditStatus)}</td></tr>`).join("") +
        `<tr class="sub"><td colspan="5">Section total — ${esc(section)} (${list.length})</td><td class="n">${rs(list.reduce((s, p) => s + p.net, 0))}</td><td></td></tr>`,
    )
    .join("");
  const total = paid.reduce((s, p) => s + p.net, 0);
  return `<table><thead><tr><th style="width:5%">#</th><th style="width:11%">Employee ID</th><th>Name</th><th>Post</th><th style="width:10%">Bank a/c</th><th class="n" style="width:12%">Net pay (₹)</th><th style="width:16%">Payment</th></tr></thead>
    <tbody>${body}<tr class="tot"><td colspan="5">Total / कुल (${paid.length})</td><td class="n">${rs(total)}</td><td></td></tr></tbody></table>
    <div class="keep"><p class="words">${esc(amountInWords(total))}<br><span lang="hi">${esc(amountInWords(total, "hi"))}</span></p>
    <p class="small muted">Paid by credit to the bank accounts above (no cash). The bank's credit report is kept with this roll.</p>
    <div class="signs" style="grid-template-columns: repeat(3, 1fr)"><div>Prepared by / तैयारकर्ता<br><b>${esc(d.run.runByName)}</b></div><div>Checked by / जाँचकर्ता<br><b>${esc(d.run.checkedByName ?? "")}</b></div><div>Drawing and Disbursing Officer<br><span lang="hi">आहरण एवं संवितरण अधिकारी</span></div></div></div>`;
}

export async function payrollPdf(actor: Actor, runId: string, doc: PrintDoc) {
  const d = await load(actor, runId);
  const body = doc === "paybill" ? payBill(d) : doc === "register" ? register(d) : doc === "schedules" ? schedules(d) : acquittance(d);
  const pdf = await renderPdf(page(d, doc, body, actor, doc === "register"), { landscape: doc === "register" });
  await audit(db, actor, { action: "PRINT", entityType: "PayrollRun", entityId: runId, summary: `Printed the ${DOC_TITLE[doc][0].toLowerCase()} for ${runTitle(d.run.payGroup as RunGroup, d.run.month)}` });
  return { pdf, fileName: `${DOC_TITLE[doc][0].replace(/\s+/g, "-")}-${d.run.month}-${d.run.payGroup}.pdf` };
}
