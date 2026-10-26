import "server-only";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { sendEmail } from "@/lib/connectors/email";
import { sendSms } from "@/lib/connectors/sms";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { financialYear, formatDateTime, formatMonth } from "@/lib/dates";
import { forbidden, notFound } from "@/lib/errors";
import { amountInWords, formatINR } from "@/lib/money";
import { embeddedFonts, logoDataUrl, renderPdf } from "@/lib/pdf";
import { fullName } from "@/modules/employees/present";
import { ensureCredits, ledgerBalances } from "@/modules/leave/balance";
import type { ArrearMonth } from "./arrears";
import { titleOf } from "./compute";
import type { PayLine } from "./engine";

/**
 * SL-01 to SL-05: salary slips. A payslip can be seen once its bill's bank file is released (credit day). It is a
 * bilingual-capable PDF in Hindi or English (SL-03) with the Board's name and logo, the person's ID, post, level and
 * cell, bank account (last four) and PAN (masked); earnings, deductions, net in figures and words, leave balance and
 * NPS / GPF to date (SL-02). On credit day each person gets an SMS link and an email with the PDF (SL-04); HR & Accounts
 * can download a whole section as one PDF (SL-05).
 */
const RELEASED = ["PAID", "CLOSED"] as const;
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const rs = (n: number) => formatINR(n, { symbol: false });

type Lang = "en" | "hi";
const L = (lang: Lang, en: string, hi: string) => (lang === "hi" ? hi : en);

/** S-44 / My payslips: the person's own released payslips, newest first. */
export async function myPayslips(actor: Actor) {
  if (!actor.employeeId) throw forbidden();
  const slips = await db.payslip.findMany({
    where: { employeeId: actor.employeeId, status: "INCLUDED", run: { status: { in: [...RELEASED] } } },
    include: { run: { select: { kind: true, seq: true, payGroup: true, month: true, source: true, paidAt: true } } },
    orderBy: [{ month: "desc" }, { createdAt: "desc" }],
  });
  return slips.map((s) => ({ id: s.id, month: s.month, kind: s.run.kind, title: titleOf(s.run), titleHi: titleOf(s.run, "hi"), gross: num(s.gross), deductions: num(s.deductions), net: num(s.net), creditStatus: s.creditStatus, paidAt: s.run.paidAt }));
}

async function loadSlips(where: { id?: string; runId?: string; sectionId?: string }) {
  return db.payslip.findMany({
    where: { ...where, status: "INCLUDED" },
    include: {
      run: true,
      employee: { select: { id: true, boardId: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, panLast4: true, type: true, post: { select: { name: true, nameHi: true } }, section: { select: { name: true, nameHi: true } } } },
    },
    orderBy: [{ sectionId: "asc" }, { employee: { employeeCode: "asc" } }],
  });
}
type Slip = Awaited<ReturnType<typeof loadSlips>>[number];

/** NPS contributions recorded to date and GPF subscriptions this financial year, from approved pay bills (SL-02). */
async function fundsToDate(employeeId: string, month: string) {
  const fyStart = `${financialYear(`${month}-01`).slice(0, 4)}-04`;
  const slips = await db.payslip.findMany({ where: { employeeId, status: "INCLUDED", month: { lte: month }, run: { status: { in: ["APPROVED", "PAID", "CLOSED"] } } }, select: { month: true, lines: true } });
  let npsOwn = 0;
  let npsBoard = 0;
  let gpf = 0;
  for (const s of slips) {
    for (const l of s.lines as unknown as PayLine[]) {
      if (l.code === "NPS") npsOwn += l.amount;
      if (l.code === "NPS_ER") npsBoard += l.amount;
      if (l.code === "GPF" && s.month >= fyStart) gpf += l.amount;
    }
  }
  return { npsOwn, npsBoard, gpf };
}

async function slipHtml(s: Slip, lang: Lang) {
  const e = s.employee;
  const lines = s.lines as unknown as PayLine[];
  const earn = lines.filter((l) => l.kind === "EARNING");
  const ded = lines.filter((l) => l.kind === "DEDUCTION");
  const name = (l: PayLine) => (lang === "hi" ? l.nameHi : l.name);
  await ensureCredits(e.boardId);
  const [balances, funds] = await Promise.all([ledgerBalances(e.id), fundsToDate(e.id, s.month)]);
  const leave = ["EL", "HPL", "CL"].filter((c) => balances.has(c)).map((c) => `${c} ${balances.get(c)}`).join(" · ");
  const detail = (s.detail ?? {}) as { arrears?: ArrearMonth[]; joinerMonth?: string; withheldMonth?: string };
  const rows = Math.max(earn.length, ded.length);
  const table = Array.from({ length: rows }, (_, i) => {
    const a = earn[i];
    const d = ded[i];
    return `<tr><td>${a ? esc(name(a)) : ""}</td><td class="n">${a ? rs(a.amount) : ""}</td><td>${d ? esc(name(d)) : ""}</td><td class="n">${d ? rs(d.amount) : ""}</td></tr>`;
  }).join("");
  const arrears = detail.arrears?.length
    ? `<h3>${L(lang, "Arrears by month (due − drawn)", "माह-वार बकाया (देय − आहरित)")}</h3><table><thead><tr><th>${L(lang, "Month", "माह")}</th><th>${L(lang, "Head", "मद")}</th><th class="n">${L(lang, "Due", "देय")}</th><th class="n">${L(lang, "Drawn", "आहरित")}</th><th class="n">${L(lang, "Arrear", "बकाया")}</th></tr></thead><tbody>${detail.arrears
        .flatMap((m) => m.lines.map((l) => `<tr><td>${esc(formatMonth(m.month, lang))}</td><td>${esc(lang === "hi" ? l.nameHi : l.name)}</td><td class="n">${rs(l.due)}</td><td class="n">${rs(l.drawn)}</td><td class="n">${rs(l.diff)}</td></tr>`))
        .join("")}</tbody></table>`
    : "";
  return `<section class="slip">
    <header><img src="${logoDataUrl()}" alt=""><div><h1>${L(lang, "Delhi Cantonment Board", "दिल्ली छावनी परिषद")}</h1><p>${L(lang, "Salary slip", "वेतन पर्ची")} — ${esc(titleOf(s.run, lang))}</p></div></header>
    <div class="who">
      <div>${L(lang, "Name", "नाम")}: <b>${esc(lang === "hi" && e.nameHi ? e.nameHi : fullName(e))}</b></div>
      <div>${L(lang, "Employee ID", "कर्मचारी आईडी")}: <b>${esc(e.employeeCode)}</b></div>
      <div>${L(lang, "Post", "पद")}: <b>${esc(lang === "hi" ? e.post.nameHi : e.post.name)}</b></div>
      <div>${L(lang, "Section", "अनुभाग")}: <b>${esc(lang === "hi" ? e.section.nameHi : e.section.name)}</b></div>
      <div>${L(lang, "Pay level / cell", "वेतन लेवल / सेल")}: <b>${s.payLevel ? `${esc(s.payLevel)} / ${esc(s.payCell)}` : "—"}</b></div>
      <div>${L(lang, "Bank account", "बैंक खाता")}: <b>••••${esc(s.bankLast4)}</b></div>
      <div>PAN: <b>${e.panLast4 ? `XXXXXX${esc(e.panLast4)}` : "—"}</b></div>
      <div>${s.daysOnRoll && num(s.daysOnRoll) > 0 ? `${L(lang, "Days paid", "भुगतान दिन")}: <b>${num(s.daysOnRoll) - num(s.lossDays)}${num(s.halfPayDays) ? ` (½ ${num(s.halfPayDays)})` : ""} / ${s.daysInMonth}</b>` : detail.joinerMonth ? `${L(lang, "Pay for", "वेतन माह")}: <b>${esc(formatMonth(detail.joinerMonth, lang))}</b>` : detail.withheldMonth ? `${L(lang, "Withheld pay of", "रोका गया वेतन")}: <b>${esc(formatMonth(detail.withheldMonth, lang))}</b>` : ""}</div>
    </div>
    <table class="main"><thead><tr><th>${L(lang, "Earnings", "आय")}</th><th class="n">₹</th><th>${L(lang, "Deductions", "कटौतियाँ")}</th><th class="n">₹</th></tr></thead>
      <tbody>${table}<tr class="tot"><td>${L(lang, "Gross", "सकल")}</td><td class="n">${rs(num(s.gross))}</td><td>${L(lang, "Total deductions", "कुल कटौतियाँ")}</td><td class="n">${rs(num(s.deductions))}</td></tr></tbody></table>
    <div class="net"><span>${L(lang, "Net pay", "शुद्ध वेतन")}</span><b>₹${rs(num(s.net))}</b></div>
    <p class="words">${esc(amountInWords(num(s.net), lang))}</p>
    ${arrears}
    <div class="extra">
      ${leave ? `<div>${L(lang, "Leave balance today", "आज अवकाश शेष")}: <b>${esc(leave)}</b></div>` : ""}
      ${e.type === "PERMANENT_NPS" ? `<div>${L(lang, "NPS to date (from pay bills)", "अब तक एनपीएस (वेतन बिलों से)")}: <b>${L(lang, "yours", "आपका")} ₹${rs(funds.npsOwn)} · ${L(lang, "Board", "परिषद")} ₹${rs(funds.npsBoard)}</b></div>` : ""}
      ${e.type === "PERMANENT_OPS" ? `<div>${L(lang, "GPF subscribed this financial year", "इस वित्त वर्ष जीपीएफ अंशदान")}: <b>₹${rs(funds.gpf)}</b></div>` : ""}
      ${s.creditStatus === "FAILED" ? `<div class="warn">${L(lang, "The bank could not credit this payment; it is being paid again.", "बैंक यह भुगतान जमा नहीं कर सका; इसे फिर से भेजा जा रहा है।")}</div>` : ""}
    </div>
    <footer>${L(lang, "Computer-generated slip; no signature needed.", "कंप्यूटर से बनी पर्ची; हस्ताक्षर की आवश्यकता नहीं।")} · DCB HRMS · ${esc(formatDateTime(new Date(), lang))}</footer>
  </section>`;
}

function doc(body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${embeddedFonts()}
    @page { size: A4; margin: 12mm; }
    body { font-family: 'Inter', 'Noto Sans Devanagari', sans-serif; color: #17201b; font-size: 9.5pt; margin: 0; }
    .slip { page-break-after: always; } .slip:last-child { page-break-after: auto; }
    header { display: flex; gap: 12px; align-items: center; border-bottom: 2px solid #116541; padding-bottom: 8px; }
    header img { width: 50px; height: 50px; } header h1 { margin: 0; font-size: 14pt; color: #0f432e; } header p { margin: 2px 0 0; color: #4f5d56; }
    .who { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px 22px; margin: 12px 0; } .who b { color: #0f432e; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th, td { border: 1px solid #d5ddd9; padding: 4px 7px; text-align: left; } th { background: #edfaf2; color: #115136; }
    .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; } .tot td { background: #e3f5ea; font-weight: 700; }
    .net { display: flex; justify-content: space-between; align-items: baseline; margin-top: 10px; padding: 10px 14px; border-radius: 10px; background: #0f432e; color: #fff; }
    .net b { font-size: 16pt; } .words { margin: 6px 0 10px; font-weight: 600; }
    h3 { font-size: 10pt; color: #0f432e; margin: 14px 0 4px; }
    .extra { margin-top: 12px; display: grid; gap: 4px; } .extra b { color: #0f432e; } .warn { color: #b91c1c; font-weight: 600; }
    footer { margin-top: 18px; font-size: 8pt; color: #6b7a72; }
  </style></head><body>${body}</body></html>`;
}

/** SL-01 to SL-03: one payslip as a PDF. An employee sees their own once paid; payroll viewers see any. */
export async function payslipPdf(actor: Actor, slipId: string, lang: Lang) {
  const [s] = await loadSlips({ id: slipId });
  if (!s || s.employee.boardId !== actor.boardId) throw notFound();
  const own = s.employeeId === actor.employeeId && (RELEASED as readonly string[]).includes(s.run.status);
  if (!own && !canAll(actor, "payroll", "view")) throw forbidden();
  const pdf = await renderPdf(doc(await slipHtml(s, lang)));
  await audit(db, actor, { action: "PRINT", entityType: "Payslip", entityId: slipId, summary: `Downloaded the payslip of ${fullName(s.employee)} for ${formatMonth(s.month)}`, sensitive: true });
  return { pdf, fileName: `Payslip-${s.employee.employeeCode}-${s.month}${s.run.kind === "SUPPLEMENTARY" ? `-S${s.run.seq}` : ""}-${lang}.pdf` };
}

/** SL-05: every payslip of a bill (or one section of it) as one PDF. */
export async function bulkPayslipsPdf(actor: Actor, runId: string, sectionId: string | undefined, lang: Lang) {
  if (!canAll(actor, "payroll", "view")) throw forbidden();
  const run = await db.payrollRun.findFirst({ where: { id: runId, boardId: actor.boardId } });
  if (!run) throw notFound();
  const slips = await loadSlips({ runId, ...(sectionId ? { sectionId } : {}) });
  if (!slips.length) throw notFound();
  const parts: string[] = [];
  for (const s of slips) parts.push(await slipHtml(s, lang));
  const pdf = await renderPdf(doc(parts.join("")));
  await audit(db, actor, { action: "PRINT", entityType: "PayrollRun", entityId: runId, summary: `Downloaded ${slips.length} payslips of ${titleOf(run)} as one PDF`, sensitive: true });
  return { pdf, fileName: `Payslips-${run.month}-${run.payGroup}${run.kind === "SUPPLEMENTARY" ? `-S${run.seq}` : ""}${sectionId ? "-section" : ""}-${lang}.pdf` };
}

/**
 * SL-04: on credit day each person paid gets an SMS link and, if an email address is on record, an email with the PDF in
 * their language. People already sent are skipped, so it is safe to run again.
 */
export async function sendPayslipNotices(boardId: string, runId: string) {
  const run = await db.payrollRun.findUnique({ where: { id: runId } });
  if (!run || run.boardId !== boardId || !(RELEASED as readonly string[]).includes(run.status)) return { sent: 0 };
  const slips = await db.payslip.findMany({
    where: { runId, status: "INCLUDED", sentAt: null },
    include: { employee: { select: { mobile: true, email: true, users: { where: { loginType: "EMPLOYEE" }, select: { language: true } } } } },
  });
  const base = env().APP_URL.replace(/\/$/, "");
  let sent = 0;
  for (const s of slips) {
    const lang: Lang = s.employee.users[0]?.language === "hi" ? "hi" : "en";
    const month = formatMonth(s.month, lang);
    if (s.employee.mobile) await sendSms(boardId, s.employee.mobile, "payslip", { month, net: rs(num(s.net)), url: `${base}/my/payslips` }, lang);
    if (s.employee.email) {
      const [full] = await loadSlips({ id: s.id });
      const pdf = await renderPdf(doc(await slipHtml(full, lang)));
      await sendEmail(
        boardId,
        s.employee.email,
        L(lang, `Salary slip for ${month} — Delhi Cantonment Board`, `${month} की वेतन पर्ची — दिल्ली छावनी परिषद`),
        L(lang, `Your salary slip for ${month} is attached. Net pay ₹${rs(num(s.net))} has been sent to your bank account.\n\nYou can also see every payslip at ${base}/my/payslips.`, `${month} की आपकी वेतन पर्ची संलग्न है। शुद्ध वेतन ₹${rs(num(s.net))} आपके बैंक खाते में भेजा गया है।\n\nसभी वेतन पर्चियाँ ${base}/my/payslips पर भी देख सकते हैं।`),
        [{ filename: `Payslip-${s.month}.pdf`, content: pdf, contentType: "application/pdf" }],
        "payslip",
      );
    }
    await db.payslip.update({ where: { id: s.id }, data: { sentAt: new Date() } });
    sent++;
  }
  await db.payrollRun.update({ where: { id: runId }, data: { payslipsSentAt: new Date() } });
  return { sent };
}

/** S-44 for HR & Accounts: released bills, with how many payslips went out. */
export async function payslipRuns(actor: Actor) {
  if (!canAll(actor, "payroll", "view")) throw forbidden();
  const runs = await db.payrollRun.findMany({ where: { boardId: actor.boardId, status: { in: ["APPROVED", ...RELEASED] } }, orderBy: [{ month: "desc" }, { kind: "asc" }, { payGroup: "asc" }, { seq: "asc" }], take: 60 });
  const counts = await db.payslip.groupBy({ by: ["runId"], where: { runId: { in: runs.map((r) => r.id) }, status: "INCLUDED" }, _count: { _all: true } });
  const sent = await db.payslip.groupBy({ by: ["runId"], where: { runId: { in: runs.map((r) => r.id) }, status: "INCLUDED", sentAt: { not: null } }, _count: { _all: true } });
  const sections = await db.section.findMany({ where: { boardId: actor.boardId, isActive: true }, select: { id: true, name: true, nameHi: true }, orderBy: { name: "asc" } });
  return {
    runs: runs.map((r) => ({ id: r.id, month: r.month, status: r.status, title: titleOf(r), titleHi: titleOf(r, "hi"), people: counts.find((c) => c.runId === r.id)?._count._all ?? 0, sent: sent.find((c) => c.runId === r.id)?._count._all ?? 0, released: (RELEASED as readonly string[]).includes(r.status) })),
    sections,
    canSend: canAll(actor, "payroll", "create"),
  };
}

export async function resendNotices(actor: Actor, runId: string) {
  if (!canAll(actor, "payroll", "create")) throw forbidden();
  const run = await db.payrollRun.findFirst({ where: { id: runId, boardId: actor.boardId } });
  if (!run) throw notFound();
  return sendPayslipNotices(actor.boardId, runId);
}
