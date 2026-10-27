import "server-only";
import { db } from "@/lib/db";
import { formatDate, toISODate } from "@/lib/dates";
import { forbidden, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { amountInWords, formatINR } from "@/lib/money";
import { embeddedFonts, logoDataUrl, renderPdf } from "@/lib/pdf";
import { matrixLevelsOn } from "@/modules/payroll/compute";
import { basicIn } from "@/modules/payroll/matrix-7cpc";

const esc = (s: string | null | undefined) => (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * RO-04: appointment letter from a template, in Hindi and English (one page each), printed for the
 * signature of the competent authority.
 */
export async function appointmentLetterPdf(actor: Actor, applicantId: string) {
  if (!canAll(actor, "recruitment", "view")) throw forbidden();
  const a = await db.applicant.findFirst({ where: { id: applicantId, vacancy: { boardId: actor.boardId } }, include: { vacancy: true } });
  if (!a || !a.appointmentLetterNo) throw notFound();
  const [board, post, section] = await Promise.all([
    db.board.findUniqueOrThrow({ where: { id: actor.boardId } }),
    db.post.findUniqueOrThrow({ where: { id: a.vacancy.postId } }),
    db.section.findUniqueOrThrow({ where: { id: a.vacancy.sectionId } }),
  ]);
  const date = toISODate(a.appointmentLetterDate!);
  // The entry pay of the level in the matrix in force on the letter's date.
  const pay = basicIn(await matrixLevelsOn(actor.boardId, date, db), a.vacancy.payLevel, 1) ?? 0;
  const advert = a.vacancy.advertNumber ? `${a.vacancy.advertNumber}${a.vacancy.advertDate ? ` dated ${formatDate(toISODate(a.vacancy.advertDate))}` : ""}` : a.vacancy.referenceNo;
  const advertHi = a.vacancy.advertNumber ? `${a.vacancy.advertNumber}${a.vacancy.advertDate ? ` दिनांक ${formatDate(toISODate(a.vacancy.advertDate), "hi")}` : ""}` : a.vacancy.referenceNo;
  const logo = logoDataUrl();

  const head = (lang: "hi" | "en") => `
    <header>
      ${logo ? `<img src="${logo}" alt="">` : ""}
      <div>
        <h1>${lang === "hi" ? esc(board.nameHi) : esc(board.name)}</h1>
        <p>${lang === "hi" ? "रक्षा मंत्रालय, भारत सरकार" : "Ministry of Defence, Government of India"}</p>
        <p>${esc(board.address ?? "")}</p>
      </div>
    </header>
    <div class="meta"><span>${lang === "hi" ? "पत्र सं." : "Letter No."} ${esc(a.appointmentLetterNo)}</span><span>${lang === "hi" ? "दिनांक" : "Date"}: ${formatDate(date, lang)}</span></div>`;

  const to = (lang: "hi" | "en") => `
    <p class="to">${lang === "hi" ? "सेवा में," : "To,"}<br><strong>${esc(lang === "hi" && a.nameHi ? a.nameHi : a.name)}</strong>${a.fatherName ? `<br>${lang === "hi" ? "पुत्र/पुत्री श्री" : "S/o / D/o Shri"} ${esc(a.fatherName)}` : ""}${a.address ? `<br>${esc(a.address)}` : ""}</p>`;

  const hi = `
    <section lang="hi">
      ${head("hi")}
      ${to("hi")}
      <p class="subject"><strong>विषय:</strong> ${esc(post.nameHi)} के पद पर नियुक्ति का प्रस्ताव।</p>
      <p>आपके आवेदन सं. ${esc(a.applicationNo)} (विज्ञापन सं. ${esc(advertHi)}) के संदर्भ में और सक्षम प्राधिकारी द्वारा स्वीकृत चयन के आधार पर, आपको दिल्ली छावनी परिषद के ${esc(section.nameHi)} में <strong>${esc(post.nameHi)}</strong> के पद पर वेतन मैट्रिक्स (7वाँ केंद्रीय वेतन आयोग) के <strong>लेवल ${esc(a.vacancy.payLevel)}</strong> में <strong>${formatINR(pay)}</strong> (${amountInWords(pay, "hi")}) प्रतिमाह के प्रारंभिक मूल वेतन तथा नियमानुसार देय भत्तों सहित, निम्नलिखित शर्तों पर नियुक्ति का प्रस्ताव दिया जाता है:</p>
      <ol>
        <li>आप कार्यग्रहण की तिथि से दो वर्ष की परिवीक्षा पर रहेंगे, जिसे बढ़ाया जा सकता है।</li>
        <li>यह नियुक्ति चिकित्सा स्वास्थ्य, पुलिस द्वारा चरित्र एवं पूर्ववृत्त के सत्यापन तथा आपके प्रमाण पत्रों के सत्यापन के अधीन है।</li>
        <li>आप राष्ट्रीय पेंशन प्रणाली (एनपीएस) और छावनी परिषद कर्मचारी सेवा नियमावली, 2021 द्वारा शासित होंगे।</li>
        <li>कार्यग्रहण पर आपको निष्ठा एवं गोपनीयता की शपथ लेनी होगी।</li>
        <li>कृपया इस पत्र की तिथि से 30 दिनों के भीतर मूल दस्तावेज़ों के साथ कार्यग्रहण हेतु उपस्थित हों, अन्यथा यह प्रस्ताव स्वतः समाप्त हो जाएगा।</li>
      </ol>
      <div class="sign"><p>मुख्य कार्यपालक अधिकारी</p><p>${esc(board.nameHi)}</p></div>
      <p class="copy">प्रतिलिपि: लेखा अनुभाग · व्यक्तिगत फ़ाइल · ${esc(section.nameHi)}</p>
    </section>`;

  const en = `
    <section lang="en">
      ${head("en")}
      ${to("en")}
      <p class="subject"><strong>Subject:</strong> Offer of appointment to the post of ${esc(post.name)}.</p>
      <p>With reference to your application no. ${esc(a.applicationNo)} against advertisement no. ${esc(advert)}, and on the basis of the selection approved by the competent authority, you are offered appointment to the post of <strong>${esc(post.name)}</strong> in the ${esc(section.name)} of Delhi Cantonment Board in <strong>Level ${esc(a.vacancy.payLevel)}</strong> of the Pay Matrix (7th CPC) with a starting basic pay of <strong>${formatINR(pay)}</strong> (${amountInWords(pay)}) per month, plus allowances admissible under the rules, on the following terms:</p>
      <ol>
        <li>You will be on probation for two years from the date of joining, which may be extended.</li>
        <li>The appointment is subject to medical fitness, verification of character and antecedents by the police, and verification of your certificates.</li>
        <li>You will be governed by the National Pension System (NPS) and the Cantonment Board Employees Service Rules, 2021.</li>
        <li>You will take the oath of allegiance and secrecy on joining.</li>
        <li>Please report for joining with your original documents within 30 days of this letter, failing which this offer will lapse.</li>
      </ol>
      <div class="sign"><p>Chief Executive Officer</p><p>${esc(board.name)}</p></div>
      <p class="copy">Copy to: Accounts Section · Personal file · ${esc(section.name)}</p>
    </section>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    ${embeddedFonts()}
    @page { size: A4; margin: 18mm 18mm 16mm; }
    body { font-family: 'Inter', 'Noto Sans Devanagari', sans-serif; color: #17201b; font-size: 11.5pt; line-height: 1.55; margin: 0; }
    section[lang="hi"] { font-family: 'Noto Sans Devanagari', 'Inter', sans-serif; line-height: 1.75; }
    section + section { page-break-before: always; }
    header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #116541; padding-bottom: 10px; }
    header img { width: 64px; height: 64px; }
    header h1 { margin: 0; font-size: 18pt; color: #0f432e; }
    header p { margin: 0; font-size: 9.5pt; color: #4f5d56; }
    .meta { display: flex; justify-content: space-between; margin: 14px 0 18px; font-size: 10pt; color: #3b4741; }
    .to { margin: 0 0 14px; }
    .subject { margin: 0 0 12px; }
    ol { padding-left: 20px; } li { margin-bottom: 6px; }
    .sign { margin-top: 56px; text-align: right; } .sign p { margin: 0; font-weight: 600; }
    .copy { margin-top: 40px; font-size: 9pt; color: #56645d; border-top: 1px solid #dfe6e2; padding-top: 8px; }
  </style></head><body>${hi}${en}</body></html>`;

  const pdf = await renderPdf(html);
  await audit(db, actor, { action: "PRINT", entityType: "Applicant", entityId: a.id, summary: `Printed appointment letter ${a.appointmentLetterNo} for ${a.name}` });
  return { pdf, fileName: `${a.appointmentLetterNo.replace(/\//g, "-")}.pdf` };
}
