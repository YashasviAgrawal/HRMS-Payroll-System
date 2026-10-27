import "server-only";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, toISODate } from "@/lib/dates";
import { amountInWords, formatINR } from "@/lib/money";
import { embeddedFonts, logoDataUrl, renderPdf } from "@/lib/pdf";
import { fullName } from "@/modules/employees/present";
import type { CaseInputs, StoredWorking } from "./cases";
import { PENSION_TYPE_LABEL, restorationDate } from "./rules";

/**
 * PN-09: the Pension Payment Order as a PDF, for physical signature by the sanctioning authority in Release 1. Both
 * languages on one page: the pensioner, the service, the pension and its commutation, family pension, the lump sums
 * and how the pension is paid. Final layout to be matched to the Board's printed PPO before go-live (PRD §18).
 */
const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const rs = (n: number) => formatINR(n);

export async function renderPpo(caseId: string): Promise<Buffer> {
  const c = await db.pensionCase.findUniqueOrThrow({ where: { id: caseId }, include: { employee: { include: { post: true, section: true, family: true } } } });
  const [board, tasks, pensioner] = await Promise.all([
    db.board.findUniqueOrThrow({ where: { id: c.boardId } }),
    db.approvalTask.findMany({ where: { boardId: c.boardId, kind: "pension.case", entityId: c.id, status: "APPROVED" }, orderBy: { decidedAt: "asc" } }),
    c.pensionerId ? db.pensioner.findUnique({ where: { id: c.pensionerId } }) : null,
  ]);
  const w = c.working as unknown as StoredWorking;
  const inputs = c.inputs as unknown as CaseInputs;
  const e = c.employee;
  const death = c.type === "FAMILY";
  const checker = tasks.find((t) => (t.payload as { step?: string }).step !== "approver");
  const approver = tasks.find((t) => (t.payload as { step?: string }).step === "approver");
  const spouse = e.family.find((m) => m.relation === "SPOUSE");
  const type = PENSION_TYPE_LABEL[c.type] ?? [c.type, c.type];
  const row = (en: string, hi: string, value: string) => `<tr><th>${en}<br><span lang="hi">${hi}</span></th><td>${value}</td></tr>`;
  const section = (en: string, hi: string, rows: string) => (rows ? `<div class="sec"><h2>${en} · <span lang="hi">${hi}</span></h2><table>${rows}</table></div>` : "");
  const restored = w.commutation.from ? restorationDate(w.commutation.from) : null;

  const partPensioner = [
    row("Name of the Government servant", "शासकीय सेवक का नाम", `<b>${esc(fullName(e))}</b>${e.nameHi ? ` · <span lang="hi">${esc(e.nameHi)}</span>` : ""}`),
    row("Employee ID", "कर्मचारी आईडी", esc(e.employeeCode)),
    row("Post and section", "पद और अनुभाग", `${esc(e.post.name)} — ${esc(e.section.name)}`),
    row("Date of birth", "जन्म तिथि", esc(formatDate(toISODate(e.dateOfBirth)))),
    row("Date of joining", "कार्यग्रहण तिथि", esc(formatDate(toISODate(e.dateOfJoining)))),
    row(death ? "Date of death" : "Date of retirement", death ? "मृत्यु तिथि" : "सेवानिवृत्ति तिथि", esc(formatDate(inputs.lastDay))),
    row("Kind of pension", "पेंशन का प्रकार", `${esc(type[0])} · <span lang="hi">${esc(type[1])}</span>`),
    row("Qualifying service", "अर्हक सेवा", `${w.qs.years} years ${w.qs.months} months ${w.qs.days} days (${w.qs.halfYears} six-monthly periods)`),
    row("Emoluments (Basic + NPA)", "परिलब्धियाँ (मूल + एनपीए)", `${rs(w.emoluments.used)} (${w.emoluments.which === "AVERAGE" ? "average of the last 10 months" : "last drawn"})`),
  ].join("");

  const partPension = w.pension.amount
    ? [
        row("Pension a month", "मासिक पेंशन", `<b>${rs(w.pension.amount)}</b> from ${esc(formatDate(w.pensionFrom))} — ${esc(amountInWords(w.pension.amount))}`),
        w.commutation.monthly
          ? row("Commuted part", "रूपांतरित भाग", `${rs(w.commutation.monthly)} a month (${w.commutation.pct}%) from ${esc(formatDate(w.commutation.from!))}; restored on ${esc(formatDate(restored!))}`)
          : "",
        w.commutation.monthly ? row("Pension after commutation", "रूपांतरण के बाद पेंशन", rs(w.commutation.reducedPension)) : "",
        row("Dearness relief", "महँगाई राहत", "At the rate of dearness allowance notified from time to time, on basic and additional pension"),
        inputs.fmaEligible ? row("Fixed medical allowance", "नियत चिकित्सा भत्ता", "At the rate in force (not with CGHS)") : "",
        row("Additional pension", "अतिरिक्त पेंशन", "From the month of reaching 80, 85, 90, 95 and 100 years, at the rates in force"),
      ].join("")
    : "";

  const fpTo = death ? inputs.familyMember : spouse ? { name: spouse.name, relation: "SPOUSE" } : null;
  const partFamily = w.familyPension.enhanced
    ? [
        fpTo ? row("Family pension to", "पारिवारिक पेंशन किसे", `${esc(fpTo.name)} (${esc(fpTo.relation)})`) : "",
        row("At the enhanced rate", "बढ़ी हुई दर पर", `${rs(w.familyPension.enhanced)} a month ${death ? `from ${esc(formatDate(w.pensionFrom))} ` : ""}until ${esc(formatDate(w.familyPension.enhancedUntil))}`),
        row("At the normal rate after that", "उसके बाद सामान्य दर पर", `${rs(w.familyPension.normal)} a month`),
      ].join("")
    : "";

  const lump = [
    w.gratuity.amount ? row(w.gratuity.kind === "DEATH" ? "Death gratuity" : w.gratuity.kind === "SERVICE" ? "Service gratuity" : "Retirement gratuity", "उपदान", rs(w.gratuity.amount)) : "",
    w.commutation.lumpSum ? row("Commuted value of pension", "पेंशन का रूपांतरित मूल्य", `${rs(w.commutation.lumpSum)} (${rs(w.commutation.monthly)} × 12 × ${w.commutation.factor}, age next birthday ${w.commutation.ageNextBirthday})`) : "",
    w.leaveEncashment.amount ? row("Leave encashment", "अवकाश नकदीकरण", `${rs(w.leaveEncashment.amount)} (${w.leaveEncashment.days} days)`) : "",
    w.gpf ? row("GPF final payment (from the fund)", "जीपीएफ अंतिम भुगतान (निधि से)", rs(w.gpf)) : "",
    w.dues.total ? row("Less dues recovered", "घटाएँ वसूली योग्य बकाया", rs(w.dues.total)) : "",
  ].join("");

  const bankLast4 = pensioner?.bankAccountLast4 ?? inputs.bank?.last4 ?? e.bankAccountLast4;
  const ifsc = pensioner?.ifsc ?? inputs.bank?.ifsc ?? e.ifsc;
  const payment = row("Paid to", "भुगतान", `Bank account ••••${esc(bankLast4)} · ${esc(ifsc)}${pensioner?.bankName ? ` · ${esc(pensioner.bankName)}` : ""} — by credit through the Board's monthly pension bill; no cash.`);

  const logo = logoDataUrl();
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    ${embeddedFonts()}
    @page { size: A4; margin: 14mm; }
    body { font-family: 'Inter', 'Noto Sans Devanagari', sans-serif; color: #17201b; font-size: 9pt; margin: 0; }
    [lang="hi"] { font-family: 'Noto Sans Devanagari', 'Inter', sans-serif; }
    header { display: flex; gap: 12px; align-items: center; border-bottom: 2px solid #116541; padding-bottom: 8px; }
    header img { width: 52px; height: 52px; } header h1 { margin: 0; font-size: 14pt; color: #0f432e; } header p { margin: 2px 0 0; color: #4f5d56; }
    .ppo { display: flex; justify-content: space-between; margin: 10px 0; padding: 8px 12px; border: 1.5px solid #116541; border-radius: 8px; background: #edfaf2; }
    .ppo b { font-size: 12pt; color: #0f432e; }
    h2 { font-size: 10pt; color: #0f432e; margin: 12px 0 4px; }
    .sec, tr, .boxes, .signs { break-inside: avoid; page-break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d5ddd9; padding: 4px 7px; text-align: left; vertical-align: top; }
    th { width: 36%; background: #f6faf8; color: #115136; font-weight: 600; } th span { font-weight: 400; color: #4f5d56; }
    .boxes { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-top: 18px; }
    .box { border: 1px dashed #9aa8a1; height: 92px; padding: 6px; font-size: 8pt; color: #4f5d56; }
    .signs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 26px; font-size: 8.5pt; }
    .signs div { border-top: 1px solid #9aa8a1; padding-top: 4px; }
    footer { margin-top: 16px; font-size: 7.5pt; color: #6b7a72; display: flex; justify-content: space-between; }
  </style></head><body>
    <header>${logo ? `<img src="${logo}" alt="">` : ""}<div><h1>${esc(board.name)} · <span lang="hi">${esc(board.nameHi)}</span></h1><p>Pension Payment Order · <span lang="hi">पेंशन भुगतान आदेश</span></p></div></header>
    <div class="ppo"><span>PPO No. / पीपीओ सं.: <b>${esc(c.ppoNumber ?? "—")}</b></span><span>Issued / जारी: <b>${c.approvedAt ? esc(formatDate(toISODate(c.approvedAt))) : "—"}</b></span></div>
    ${section("Part I — The pensioner and the service", "भाग I — पेंशनभोगी और सेवा", partPensioner)}
    ${section("Part II — Pension", "भाग II — पेंशन", partPension)}
    ${section("Part III — Family pension", "भाग III — पारिवारिक पेंशन", partFamily)}
    ${section("Part IV — Paid at once", "भाग IV — एकमुश्त भुगतान", lump)}
    ${section("Part V — Payment", "भाग V — भुगतान", payment)}
    <div class="boxes"><div class="box">Joint photograph of the pensioner and spouse<br><span lang="hi">पेंशनभोगी और पति/पत्नी का संयुक्त फ़ोटो</span></div><div class="box">Specimen signature or thumb impression of the pensioner<br><span lang="hi">पेंशनभोगी के नमूना हस्ताक्षर या अंगूठे का निशान</span></div><div class="box">Seal of the Board<br><span lang="hi">परिषद की मुहर</span></div></div>
    <div class="signs">
      <div>Prepared by / तैयारकर्ता<br><b>${esc(c.createdByName)}</b></div>
      <div>Checked by / जाँचकर्ता<br><b>${esc(checker?.deciderName ?? "")}</b></div>
      <div>Sanctioned by / स्वीकृतकर्ता<br><b>${esc(approver?.deciderName ?? "")}</b><br>Signature of the sanctioning authority<br><span lang="hi">स्वीकृति प्राधिकारी के हस्ताक्षर</span></div>
    </div>
    <footer><span>Generated by DCB HRMS on ${esc(formatDateTime(new Date()))}. Valid only with the physical signature of the sanctioning authority.</span><span>${esc(c.ppoNumber ?? "")}</span></footer>
  </body></html>`;
  return renderPdf(html);
}
