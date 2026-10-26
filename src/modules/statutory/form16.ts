import "server-only";
import type { ApprovalTask } from "@/generated/prisma/client";
import { submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { sendSms } from "@/lib/connectors/sms";
import { blindIndex } from "@/lib/crypto";
import { db, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate, formatMonth, todayIST } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { amountInWords } from "@/lib/money";
import { emit } from "@/lib/outbox";
import { renderPdf } from "@/lib/pdf";
import { loadFile, saveFile, sniff } from "@/lib/storage";
import { form16Workings, type YearWorking } from "./form16-working";
import { esc, rs, statPage } from "./pdf";
import { statutorySettings, type StatutorySettings } from "./settings";
import { fyMonths, fyOfMonth } from "./tax-rules";

/**
 * ST-07, S-53: Form 16 for each person and year. Part B (the salary and tax working) is generated here from the year's
 * approved pay bills; Part A (TDS deposited, from TRACES) is imported as the PDFs TRACES gives, matched by the PAN in
 * each file name. Once the year is over, publishing goes to an Admin; then each person finds both parts in their login.
 */
const canSee = (actor: Actor) => canAll(actor, "statutory", "view");
const canManage = (actor: Actor) => canAll(actor, "statutory", "create");
const PAN_IN_NAME = /[A-Z]{5}[0-9]{4}[A-Z]/;
const yearOver = (fy: string) => todayIST().slice(0, 7) > fyMonths(fy)[1];

/** S-53: everyone paid in the year with their figures and where each part stands. */
export async function form16Year(actor: Actor, fyParam?: string) {
  if (!canSee(actor)) throw forbidden();
  const thisFy = fyOfMonth(todayIST().slice(0, 7));
  const runs = await db.payrollRun.findMany({ where: { boardId: actor.boardId, status: { in: ["APPROVED", "PAID", "CLOSED"] } }, select: { month: true }, distinct: ["month"] });
  const years = [...new Set([thisFy, ...runs.map((r) => fyOfMonth(r.month))])].sort().reverse();
  const fy = fyParam && years.includes(fyParam) ? fyParam : (years.find((y) => yearOver(y)) ?? thisFy);
  const [workings, forms, pending] = await Promise.all([
    form16Workings(db, actor.boardId, fy),
    db.form16.findMany({ where: { boardId: actor.boardId, fy } }),
    db.approvalTask.findFirst({ where: { boardId: actor.boardId, kind: "form16.publish", status: "PENDING", entityId: fy } }),
  ]);
  const formBy = new Map(forms.map((f) => [f.employeeId, f]));
  const rows = workings.map((w) => {
    const f = formBy.get(w.employeeId);
    return {
      employeeId: w.employeeId,
      code: w.code,
      name: w.name,
      nameHi: w.nameHi,
      panLast4: w.panLast4,
      regime: w.working.regime,
      gross: w.working.gross,
      taxable: w.working.taxable,
      tax: w.working.total,
      tds: w.tds,
      partB: Boolean(f?.partBKey),
      partA: Boolean(f?.partAKey),
      published: Boolean(f?.publishedAt),
      formId: f?.id ?? null,
    };
  });
  return {
    fy,
    years,
    yearOver: yearOver(fy),
    rows,
    counts: { people: rows.length, partB: rows.filter((r) => r.partB).length, partA: rows.filter((r) => r.partA).length, published: rows.filter((r) => r.published).length, taxShort: rows.filter((r) => r.tds < r.tax).length },
    waiting: Boolean(pending),
    canManage: canManage(actor),
  };
}

function partBHtml(w: YearWorking, fy: string, s: StatutorySettings, draft: boolean) {
  const t = w.working;
  const via = t.chapterVIA;
  const viaTotal = via.sec80C + via.sec80D + via.sec80CCD1B + via.homeLoanInterest + t.employerNps;
  const row = (label: string, value: number | string, cls = "") => `<tr class="${cls}"><td>${esc(label)}</td><td class="n">${typeof value === "number" ? rs(value) : esc(value)}</td></tr>`;
  const payable = t.total;
  const body = `
    ${draft ? `<p style="margin:6px 0;padding:5px 8px;border:1.5px dashed #b45309;color:#92400e;font-weight:700;text-align:center">DRAFT — the financial year is not over</p>` : ""}
    <h2>Details of salary paid and tax deducted</h2>
    <table><tbody>
      ${row("1. Gross salary — salary as per section 17(1)", t.gross)}
      ${w.carriedIn ? row("   of which paid outside this system (old system / previous employer)", w.carriedIn.salary, "sub") : ""}
      ${row("2. Less: allowances exempt u/s 10 — house rent allowance u/s 10(13A)", t.hraExempt)}
      ${row("3. Salary after exemptions (1 − 2)", t.gross - t.hraExempt, "sub")}
      ${row("4. Deductions u/s 16: (a) standard deduction u/s 16(ia)", t.standardDeduction)}
      ${row("   (c) tax on employment u/s 16(iii)", t.professionalTax)}
      ${row("5. Income chargeable under the head Salaries (3 − 4)", t.gross - t.hraExempt - t.standardDeduction - t.professionalTax, "sub")}
      ${row("6. Add: other income reported by the employee", t.otherIncome)}
      ${row("7. Gross total income (5 + 6)", t.gross - t.hraExempt - t.standardDeduction - t.professionalTax + t.otherIncome, "sub")}
      ${row("8. Deductions under Chapter VI-A: 80C (incl. own NPS / GPF)", via.sec80C)}
      ${row("   80CCD(1B) — own NPS", via.sec80CCD1B)}
      ${row("   80CCD(2) — employer's NPS contribution", t.employerNps)}
      ${row("   80D — health insurance", via.sec80D)}
      ${row("   Interest on housing loan u/s 24(b)", via.homeLoanInterest)}
      ${row("9. Total deductions", viaTotal, "sub")}
      ${row("10. Total taxable income (7 − 9), rounded to ₹10", t.taxable, "tot")}
      ${row("11. Tax on total income", t.tax)}
      ${row("12. Rebate u/s 87A", t.rebate)}
      ${row("13. Health and education cess (4%)", t.cess)}
      ${row("14. Tax payable (11 − 12 + 13)", payable, "tot")}
      ${row("15. Relief u/s 89", 0)}
      ${row("16. Tax deducted at source (TDS) in the year", w.tds, "tot")}
      ${row(payable >= w.tds ? "17. Tax still payable" : "17. Tax deducted in excess (refund through the return)", Math.abs(payable - w.tds))}
    </tbody></table>
    <p class="small muted">Regime: ${t.regime === "NEW" ? "new tax regime u/s 115BAC (default)" : "old regime — the employee opted out of section 115BAC"}. ${w.basis === "VERIFIED" ? "Deductions as verified from the proofs given." : "No deductions verified for the year."}</p>
    <h2>Tax deducted month by month</h2>
    <table><thead><tr><th>Month</th><th class="n">Taxable salary (₹)</th><th class="n">TDS (₹)</th></tr></thead><tbody>
      ${w.carriedIn ? `<tr class="sub"><td>${esc(w.carriedIn.note)}</td><td class="n">${rs(w.carriedIn.salary)}</td><td class="n">${rs(w.carriedIn.tds)}</td></tr>` : ""}
      ${w.months.map((m) => `<tr><td>${esc(formatMonth(m.month))}</td><td class="n">${rs(m.gross)}</td><td class="n">${rs(m.tds)}</td></tr>`).join("")}
    </tbody></table>
    <div class="keep">
      <h2>Verification</h2>
      <p>I, ${esc(s.responsibleName || "________________")}, ${esc(s.responsibleDesignation)}, certify that the information above is true, complete and correct and is based on the books of account and records available. Tax deducted: ₹${rs(w.tds)} (${esc(amountInWords(w.tds))}).</p>
      <div class="sign"><div>${esc(s.responsibleName || "Signature")}<br>${esc(s.responsibleDesignation)}<br>Place: Delhi Cantonment · Date: ${esc(formatDate(todayIST()))}</div></div>
    </div>`;
  return statPage({
    title: "Form No. 16 — Part B (Annexure)",
    subtitle: `Certificate under section 203 of the Income-tax Act for tax deducted at source on salary · Financial year ${fy} (assessment year ${Number(fy.slice(0, 4)) + 1}-${String((Number(fy.slice(0, 4)) + 2) % 100).padStart(2, "0")})`,
    meta: [
      ["Employer", s.deductorName],
      ["Employer TAN", s.tan || "—"],
      ["Employer PAN", s.pan || "—"],
      ["Employee", `${w.name} (${w.code})`],
      ["Employee PAN", w.panLast4 ? `XXXXXX${w.panLast4}` : "Not given"],
      ["Designation", w.post],
      ["Period with the employer", `${formatDate(w.from)} to ${formatDate(w.to)}`],
      ["Regime", w.working.regime === "NEW" ? "New (115BAC)" : "Old"],
    ],
    body,
    footer: `Form 16 Part B · ${s.deductorName} · TAN ${s.tan || "—"}`,
  });
}

/** Generates Part B for everyone paid in the year (again, if already made — e.g. after a late correction). */
export async function generatePartB(actor: Actor, fy: string) {
  if (!canManage(actor)) throw forbidden();
  if (!/^\d{4}-\d{2}$/.test(fy)) throw badRequest("errors.validation");
  const [workings, settings, published] = await Promise.all([form16Workings(db, actor.boardId, fy), statutorySettings(db, actor.boardId), db.form16.count({ where: { boardId: actor.boardId, fy, publishedAt: { not: null } } })]);
  if (published) throw conflict("statutory.form16.alreadyPublished");
  if (!workings.length) throw badRequest("statutory.form16.nobody");
  const draft = !yearOver(fy);
  for (const w of workings) {
    const pdf = await renderPdf(partBHtml(w, fy, settings, draft));
    const stored = await saveFile("tax-forms", pdf, "pdf");
    const working = JSON.parse(JSON.stringify({ ...w.working, tds: w.tds, carriedIn: w.carriedIn }));
    await db.form16.upsert({
      where: { employeeId_fy: { employeeId: w.employeeId, fy } },
      create: { boardId: actor.boardId, employeeId: w.employeeId, fy, partBKey: stored.key, partBSha: stored.sha256, working },
      update: { partBKey: stored.key, partBSha: stored.sha256, working },
    });
  }
  await audit(db, actor, { action: "GENERATE", entityType: "Form16", entityId: fy, summary: `Form 16 Part B generated for ${workings.length} people (${fy})${draft ? " — draft, year not over" : ""}` });
  return { count: workings.length, draft };
}

/** Part A PDFs from TRACES, matched to people by the PAN in each file name. */
export async function importPartA(actor: Actor, fy: string, files: File[]) {
  if (!canManage(actor)) throw forbidden();
  if (!/^\d{4}-\d{2}$/.test(fy)) throw badRequest("errors.validation");
  if (!files.length) throw badRequest("errors.validation", { files: "validation.required" });
  const matched: { file: string; code: string; name: string }[] = [];
  const unmatched: { file: string; reason: "noPan" | "notPdf" | "noEmployee" | "tooBig" }[] = [];
  for (const file of files.slice(0, 500)) {
    const pan = file.name.toUpperCase().match(PAN_IN_NAME)?.[0];
    if (!pan) {
      unmatched.push({ file: file.name, reason: "noPan" });
      continue;
    }
    if (file.size > 5 * 1024 * 1024) {
      unmatched.push({ file: file.name, reason: "tooBig" });
      continue;
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (sniff(buffer) !== "pdf") {
      unmatched.push({ file: file.name, reason: "notPdf" });
      continue;
    }
    const e = await db.employee.findFirst({ where: { boardId: actor.boardId, panHash: blindIndex("pan", pan) }, select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true } });
    if (!e) {
      unmatched.push({ file: file.name, reason: "noEmployee" });
      continue;
    }
    const stored = await saveFile("tax-forms", buffer, "pdf");
    await db.form16.upsert({
      where: { employeeId_fy: { employeeId: e.id, fy } },
      create: { boardId: actor.boardId, employeeId: e.id, fy, partAKey: stored.key, partASha: stored.sha256 },
      update: { partAKey: stored.key, partASha: stored.sha256 },
    });
    matched.push({ file: file.name, code: e.employeeCode ?? "", name: [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" ") });
  }
  await audit(db, actor, { action: "UPLOAD", entityType: "Form16", entityId: fy, summary: `Form 16 Part A imported for ${fy}: ${matched.length} matched, ${unmatched.length} not matched` });
  return { matched, unmatched };
}

/** Publishing goes to an Admin once the year is over and every person has Part B. */
export async function proposePublish(actor: Actor, fy: string) {
  if (!canManage(actor)) throw forbidden();
  const y = await form16Year(actor, fy);
  if (!y.yearOver) throw conflict("statutory.form16.yearNotOver");
  if (y.waiting) throw conflict("statutory.files.waiting");
  if (y.counts.partB < y.counts.people) throw conflict("statutory.form16.partBMissing");
  return db.$transaction(async (tx) =>
    submitForApproval(tx, actor, {
      kind: "form16.publish",
      title: `Publish Form 16 for ${fy}: ${y.counts.people} people`,
      titleHi: `फ़ॉर्म 16 ${fy} प्रकाशित करें: ${y.counts.people} लोग`,
      details: {
        summary: "Once approved, each person can download Part A and Part B from their login and gets an SMS.",
        summaryHi: "स्वीकृति के बाद हर व्यक्ति अपने लॉगिन से भाग क और भाग ख डाउनलोड कर सकेगा और उसे एसएमएस मिलेगा।",
        link: `/statutory/form16?fy=${fy}`,
        rows: [
          { label: "People", labelHi: "लोग", new: String(y.counts.people) },
          { label: "Part B generated", labelHi: "भाग ख बना", new: String(y.counts.partB) },
          { label: "Part A imported", labelHi: "भाग क आयात", new: String(y.counts.partA) },
          { label: "Tax deducted short of tax payable", labelHi: "देय कर से कम कटौती", new: String(y.counts.taxShort) },
        ],
      } satisfies ApprovalDetails,
      payload: { fy },
      entityType: "Form16",
      entityId: fy,
    }),
  );
}

export async function onPublishApproved(tx: Tx, task: ApprovalTask, fy: string, afterCommit: (fn: () => Promise<void>) => void) {
  const rows = await tx.form16.findMany({ where: { boardId: task.boardId, fy, partBKey: { not: null }, publishedAt: null }, include: { employee: { select: { mobile: true, users: { select: { language: true }, take: 1 } } } } });
  await tx.form16.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { publishedAt: new Date() } });
  await emit(tx, task.boardId, "form16.published", { type: "Form16", id: fy }, { people: rows.length });
  afterCommit(async () => {
    for (const r of rows) {
      if (!r.employee.mobile) continue;
      const lang = r.employee.users[0]?.language === "hi" ? "hi" : "en";
      const text = lang === "hi" ? `वित्त वर्ष ${fy} का आपका फ़ॉर्म 16 तैयार है। ${env().APP_URL}/my/payslips पर देखें` : `Your Form 16 for ${fy} is ready. See it at ${env().APP_URL}/my/payslips`;
      await sendSms(task.boardId, r.employee.mobile, "alert", { text }, lang);
    }
  });
}

/** The person's published Form 16s (Payslips and Form 16). */
export async function myForm16(actor: Actor) {
  if (!actor.employeeId) return [];
  const rows = await db.form16.findMany({ where: { employeeId: actor.employeeId, publishedAt: { not: null } }, orderBy: { fy: "desc" } });
  return rows.map((r) => ({ id: r.id, fy: r.fy, partA: Boolean(r.partAKey), partB: Boolean(r.partBKey), publishedAt: r.publishedAt!.toISOString() }));
}

export async function form16File(actor: Actor, id: string, part: "A" | "B") {
  const f = await db.form16.findFirst({ where: { id, boardId: actor.boardId }, include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } } } });
  if (!f) throw notFound();
  const own = f.employeeId === actor.employeeId && f.publishedAt !== null;
  if (!own && !canSee(actor)) throw forbidden();
  const key = part === "A" ? f.partAKey : f.partBKey;
  if (!key) throw notFound();
  const buffer = await loadFile(key);
  await audit(db, actor, { action: "DOWNLOAD", entityType: "Form16", entityId: f.id, summary: `Form 16 Part ${part} ${f.fy} of ${f.employee.firstName} ${f.employee.lastName ?? ""}`.trim(), sensitive: true });
  return { buffer, fileName: `Form16-Part${part}-${f.employee.employeeCode}-${f.fy}.pdf` };
}

