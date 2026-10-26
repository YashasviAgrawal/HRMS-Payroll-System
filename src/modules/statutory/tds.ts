import "server-only";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { formatMonth, fromISODate, isMonth, todayIST, toISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { createOutgoingFile } from "@/lib/files";
import { formatINR } from "@/lib/money";
import { emit } from "@/lib/outbox";
import { isoDateField } from "@/lib/validators";
import { fullName } from "@/modules/employees/present";
import type { PayLine } from "@/modules/payroll/engine";
import { allocateToChallans, form24qFile, type ChallanRow, type SalaryDetailRow } from "./formats";
import { form16Workings } from "./form16-working";
import { statutorySettings } from "./settings";
import { fyMonths, fyOfMonth, quarterOf } from "./tax-rules";

/**
 * ST-05, ST-06, S-52: TDS deducted each month (from the approved pay bills), the challans that deposited it, and the
 * quarterly Form 24Q statement — built only when every rupee deducted in the quarter sits under a challan, then
 * previewed and released by an Admin like every other file (ST-09).
 */
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const PAID = ["APPROVED", "PAID", "CLOSED"] as const;
const RELEASED = ["APPROVED", "DOWNLOADED"];
const canSee = (actor: Actor) => canAll(actor, "statutory", "view");
const canManage = (actor: Actor) => canAll(actor, "statutory", "create");
const money = z.coerce.number().min(0, "validation.invalid").max(100_000_000, "validation.invalid");

export const challanSchema = z.object({
  month: z.string().refine(isMonth, "validation.invalid"),
  bsrCode: z.string().trim().regex(/^\d{7}$/, "statutory.tds.bsrFormat"),
  challanNo: z.string().trim().regex(/^\d{5}$/, "statutory.tds.challanFormat"),
  depositedOn: isoDateField,
  tax: money,
  cess: money,
  interest: money.default(0),
});

const quarterMonths = (fy: string, q: 1 | 2 | 3 | 4) => {
  const start = Number(fy.slice(0, 4));
  const ms = q === 4 ? [1, 2, 3].map((m) => `${start + 1}-0${m}`) : [0, 1, 2].map((i) => `${start}-${String(4 + (q - 1) * 3 + i).padStart(2, "0")}`);
  return ms;
};

/** TDS in each approved bill line by person and month, with the day the pay went out. */
async function deducted(boardId: string, from: string, to: string) {
  const slips = await db.payslip.findMany({
    where: { boardId, month: { gte: from, lte: to }, status: "INCLUDED", run: { status: { in: [...PAID] } } },
    select: { employeeId: true, month: true, lines: true, gross: true, run: { select: { paidAt: true, approvedAt: true } } },
  });
  return slips
    .map((s) => ({
      employeeId: s.employeeId,
      month: s.month,
      tds: (s.lines as unknown as PayLine[]).filter((l) => l.code === "IT").reduce((a, l) => a + l.amount, 0),
      paid: num(s.gross),
      paidOn: toISODate(s.run.paidAt ?? s.run.approvedAt ?? new Date()),
    }))
    .filter((x) => x.tds > 0);
}

/** S-52 TDS tab: month by month deducted vs deposited, the challans, and each quarter's 24Q. */
export async function tdsYear(actor: Actor, fyParam?: string) {
  if (!canSee(actor)) throw forbidden();
  const today = todayIST();
  const fy = fyParam && /^\d{4}-\d{2}$/.test(fyParam) ? fyParam : fyOfMonth(today.slice(0, 7));
  const [from, to] = fyMonths(fy);
  const [rows, challans, files, rule, people, billed] = await Promise.all([
    deducted(actor.boardId, from, to),
    db.tdsChallan.findMany({ where: { boardId: actor.boardId, fy }, orderBy: [{ month: "asc" }, { depositedOn: "asc" }] }),
    db.fileRecord.findMany({ where: { boardId: actor.boardId, kind: "tds.24q", period: { startsWith: fy } }, orderBy: { createdAt: "desc" } }),
    db.dueRule.findUnique({ where: { boardId_code: { boardId: actor.boardId, code: "TDS_DEPOSIT" } } }),
    db.employee.findMany({ where: { boardId: actor.boardId }, select: { id: true, panLast4: true } }),
    db.payrollRun.findMany({ where: { boardId: actor.boardId, month: { gte: from, lte: to }, kind: "REGULAR", status: { in: [...PAID] } }, select: { month: true }, distinct: ["month"] }),
  ]);
  const billedMonths = new Set(billed.map((b) => b.month));
  // Months before the first pay bill made here were paid by the old system (their TDS is carried in), so they start the list only once billed.
  const firstBilled = [...billedMonths, ...challans.map((c) => c.month)].sort()[0];
  const hasPan = new Map(people.map((p) => [p.id, Boolean(p.panLast4)]));
  const day = rule?.day ?? 7;
  const months: string[] = [];
  for (let m = firstBilled && firstBilled > from ? firstBilled : from; m <= to && m <= today.slice(0, 7); m = shiftM(m, 1)) months.push(m);
  const monthRows = months.map((m) => {
    const here = rows.filter((r) => r.month === m);
    const tds = here.reduce((s, r) => s + r.tds, 0);
    const ch = challans.filter((c) => c.month === m);
    const deposited = ch.reduce((s, c) => s + num(c.tax) + num(c.cess) + num(c.interest), 0);
    const dueOn = `${shiftM(m, 1)}-${String(Math.min(day, 28)).padStart(2, "0")}`;
    const status = tds === 0 ? (billedMonths.has(m) ? "NOTHING" : "PENDING") : deposited >= tds ? "DEPOSITED" : deposited > 0 ? "SHORT" : today > dueOn ? "OVERDUE" : "DUE";
    return {
      month: m,
      people: new Set(here.map((r) => r.employeeId)).size,
      tds: round2(tds),
      deposited: round2(deposited),
      dueOn,
      status,
      challans: ch.map((c) => ({ id: c.id, bsrCode: c.bsrCode, challanNo: c.challanNo, depositedOn: toISODate(c.depositedOn), tax: num(c.tax), cess: num(c.cess), interest: num(c.interest) })),
    };
  });
  const quarters = ([1, 2, 3, 4] as const).map((q) => {
    const qm = quarterMonths(fy, q);
    const qRows = monthRows.filter((r) => qm.includes(r.month));
    const file = files.find((f) => f.period === `${fy} Q${q}`);
    const ended = today.slice(0, 7) > qm[2];
    const short = qRows.filter((r) => r.tds > r.deposited).map((r) => r.month);
    const ids = new Set(rows.filter((r) => qm.includes(r.month)).map((r) => r.employeeId));
    return {
      quarter: q,
      months: qm,
      tds: round2(qRows.reduce((s, r) => s + r.tds, 0)),
      deposited: round2(qRows.reduce((s, r) => s + r.deposited, 0)),
      deductees: ids.size,
      noPan: [...ids].filter((id) => !hasPan.get(id)).length,
      ended,
      short,
      file: file ? { id: file.id, status: file.status, fileName: file.fileName, sha256: file.sha256, createdAt: file.createdAt.toISOString() } : null,
    };
  });
  return { fy, months: monthRows, quarters, canManage: canManage(actor) };
}

function shiftM(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** ST-05: a challan recorded against the month whose TDS it deposited. */
export async function recordChallan(actor: Actor, raw: unknown) {
  if (!canManage(actor)) throw forbidden();
  const c = challanSchema.parse(raw);
  if (c.month > todayIST().slice(0, 7)) throw badRequest("errors.validation", { month: "statutory.tds.futureMonth" });
  if (c.depositedOn < `${c.month}-01`) throw badRequest("errors.validation", { depositedOn: "statutory.tds.depositedBefore" });
  if (c.tax + c.cess + c.interest <= 0) throw badRequest("errors.validation", { tax: "validation.invalid" });
  const fy = fyOfMonth(c.month);
  if (await quarterReleased(actor.boardId, fy, quarterOf(c.month))) throw conflict("statutory.tds.quarterFiled");
  return db.$transaction(async (tx) => {
    if (await tx.tdsChallan.findUnique({ where: { boardId_month_challanNo: { boardId: actor.boardId, month: c.month, challanNo: c.challanNo } } })) throw conflict("statutory.tds.challanExists");
    const row = await tx.tdsChallan.create({ data: { boardId: actor.boardId, fy, month: c.month, bsrCode: c.bsrCode, challanNo: c.challanNo, depositedOn: fromISODate(c.depositedOn), tax: c.tax, cess: c.cess, interest: c.interest, createdById: actor.userId } });
    await audit(tx, actor, { action: "CREATE", entityType: "TdsChallan", entityId: row.id, summary: `TDS challan ${c.bsrCode}/${c.challanNo} of ${formatINR(c.tax + c.cess + c.interest)} recorded for ${formatMonth(c.month)}`, newValue: c });
    await emit(tx, actor.boardId, "tds.challan.recorded", { type: "TdsChallan", id: row.id }, { month: c.month, amount: c.tax + c.cess + c.interest });
    return row;
  });
}

async function quarterReleased(boardId: string, fy: string, q: number) {
  return Boolean(await db.fileRecord.findFirst({ where: { boardId, kind: "tds.24q", period: `${fy} Q${q}`, status: { in: RELEASED as never } } }));
}

/** A challan entered by mistake, until its quarter's 24Q is released. */
export async function removeChallan(actor: Actor, id: string) {
  if (!canManage(actor)) throw forbidden();
  const c = await db.tdsChallan.findFirst({ where: { id, boardId: actor.boardId } });
  if (!c) throw notFound();
  if (await quarterReleased(actor.boardId, c.fy, quarterOf(c.month))) throw conflict("statutory.tds.quarterFiled");
  await db.$transaction(async (tx) => {
    await tx.tdsChallan.delete({ where: { id } });
    await audit(tx, actor, { action: "DELETE", entityType: "TdsChallan", entityId: id, summary: `TDS challan ${c.bsrCode}/${c.challanNo} for ${formatMonth(c.month)} removed`, oldValue: { bsrCode: c.bsrCode, challanNo: c.challanNo, tax: num(c.tax) } });
  });
}

/** ST-06: the quarter's Form 24Q, built when the quarter is over and its TDS is fully under challans. */
export async function make24q(actor: Actor, fy: string, quarter: 1 | 2 | 3 | 4) {
  if (!canManage(actor)) throw forbidden();
  if (!/^\d{4}-\d{2}$/.test(fy) || ![1, 2, 3, 4].includes(quarter)) throw badRequest("errors.validation");
  const settings = await statutorySettings(db, actor.boardId);
  if (!settings.tan || !settings.pan || !settings.responsibleName) throw badRequest("statutory.tds.needTan");
  const qm = quarterMonths(fy, quarter);
  if (todayIST().slice(0, 7) <= qm[2]) throw conflict("statutory.tds.quarterNotOver");
  const pending = await db.fileRecord.findFirst({ where: { boardId: actor.boardId, kind: "tds.24q", period: `${fy} Q${quarter}`, status: { in: ["PREVIEW", ...RELEASED] as never } } });
  if (pending) throw conflict(pending.status === "PREVIEW" ? "statutory.files.waiting" : "statutory.tds.quarterFiled");
  const rows = await deducted(actor.boardId, qm[0], qm[2]);
  const challans = await db.tdsChallan.findMany({ where: { boardId: actor.boardId, month: { in: qm } }, orderBy: [{ month: "asc" }, { depositedOn: "asc" }] });
  const employees = await db.employee.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, firstName: true, middleName: true, lastName: true, panEnc: true, employeeCode: true, panLast4: true } });
  const byId = new Map(employees.map((e) => [e.id, e]));
  const out: ChallanRow[] = [];
  const preview: (string | number)[][] = [];
  for (const m of qm) {
    const people = rows.filter((r) => r.month === m).map((r) => {
      const e = byId.get(r.employeeId)!;
      return { pan: e.panEnc ? decrypt(e.panEnc) : "PANNOTAVBL", name: fullName(e).toUpperCase(), paid: r.paid, tds: r.tds, paidOn: r.paidOn, code: e.employeeCode ?? "", last4: e.panLast4 ?? "" };
    });
    const ch = challans.filter((c) => c.month === m);
    const { byChallan, short } = allocateToChallans(ch.map((c) => ({ id: c.id, amount: num(c.tax) + num(c.cess) + num(c.interest) })), people);
    if (short > 0) throw conflict("statutory.tds.challanShort", { month: formatMonth(m), amount: formatINR(short) });
    for (const c of ch) {
      const ds = byChallan.get(c.id) ?? [];
      out.push({ bsrCode: c.bsrCode, challanNo: c.challanNo, depositedOn: toISODate(c.depositedOn), tax: num(c.tax), cess: num(c.cess), interest: num(c.interest), deductees: ds.map(({ pan, name, paid, tds, paidOn }) => ({ pan, name, paid, tds, paidOn })) });
      for (const d of ds) preview.push([formatMonth(m), `${c.bsrCode}/${c.challanNo}`, d.code, d.name, d.last4 ? `XXXXXX${d.last4}` : "PANNOTAVBL", d.tds]);
    }
  }
  let salary: SalaryDetailRow[] = [];
  if (quarter === 4) {
    const workings = await form16Workings(db, actor.boardId, fy);
    salary = workings.map((w) => ({
      pan: w.panEnc ? decrypt(w.panEnc) : "PANNOTAVBL",
      name: w.name.toUpperCase(),
      from: w.from,
      to: w.to,
      newRegime: w.working.regime === "NEW",
      gross: w.working.gross,
      standardDeduction: w.working.standardDeduction,
      hraExempt: w.working.hraExempt,
      professionalTax: w.working.professionalTax,
      otherIncome: w.working.otherIncome,
      chapterVIA: w.working.chapterVIA.sec80C + w.working.chapterVIA.sec80D + w.working.chapterVIA.sec80CCD1B + w.working.chapterVIA.homeLoanInterest + w.working.employerNps,
      taxable: w.working.taxable,
      tax: w.working.tax,
      rebate: w.working.rebate,
      cess: w.working.cess,
      tds: w.tds,
    }));
  }
  const text = form24qFile({ tan: settings.tan, pan: settings.pan, name: settings.deductorName, address: settings.address, responsible: settings.responsibleName, designation: settings.responsibleDesignation }, fy, quarter, out, todayIST(), salary);
  const tds = out.reduce((s, c) => s + c.deductees.reduce((a, d) => a + d.tds, 0), 0);
  return createOutgoingFile(actor, {
    kind: "tds.24q",
    period: `${fy} Q${quarter}`,
    fileName: `24Q_${settings.tan}_${fy}_Q${quarter}.txt`,
    ext: "txt",
    mimeType: "text/plain",
    buffer: Buffer.from(text, "utf8"),
    preview: { columns: ["Month", "Challan", "Employee ID", "Name", "PAN", "TDS (₹)"], rows: preview.slice(0, 50), totalRows: preview.length, totals: { "Challans": out.length, "TDS (₹)": formatINR(tds), ...(salary.length ? { "Salary details (Annexure II)": salary.length } : {}) } },
    title: `Form 24Q ${fy} Q${quarter}: ${out.length} challans, ${formatINR(tds)}`,
    titleHi: `फ़ॉर्म 24क्यू ${fy} तिमाही ${quarter}: ${out.length} चालान, ${formatINR(tds)}`,
    link: `/statutory/tds?fy=${fy}`,
  });
}
