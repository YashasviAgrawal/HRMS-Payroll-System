import "server-only";
import { db } from "@/lib/db";
import { formatMonth, toISODate } from "@/lib/dates";
import { formatINR, fromPaise, toPaise } from "@/lib/money";
import type { ArrearMonth } from "@/modules/payroll/arrears";
import { titleOf } from "@/modules/payroll/compute";
import type { PayLine } from "@/modules/payroll/engine";
import { loanPosition } from "@/modules/payroll/loan-rules";
import { linesOf, nameOf, previous, salarySlips, sectionNames, sectionOf, type SalarySlip } from "./common";
import { PAID, num, type Col, type ReportDef, type ReportFilters, type Row } from "./types";
import { shiftMonth } from "@/lib/dates";

/**
 * Reports 11–19 (PRD §11, Payroll): read from approved pay bills only — what was actually paid, regular and supplementary
 * bills together, pay withheld left out (it is paid when a supplementary bill releases it).
 */

type F = ReportFilters & { scopeSectionId: string | null };

async function headOrder(boardId: string) {
  const heads = await db.payHead.findMany({ where: { boardId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }], select: { code: true, name: true, nameHi: true, kind: true, accountHead: true } });
  return heads;
}

/** Head columns for the heads that appear in the slips, in pay-head order (heads no longer in the master go last). */
function headCols(heads: Awaited<ReturnType<typeof headOrder>>, slips: { lines: unknown }[], kind: PayLine["kind"]): Col[] {
  const seen = new Map<string, PayLine>();
  for (const s of slips) for (const l of linesOf(s)) if (l.kind === kind && l.amount !== 0 && !seen.has(l.code)) seen.set(l.code, l);
  const ordered = heads.filter((h) => seen.has(h.code)).map((h) => ({ code: h.code, name: h.name, nameHi: h.nameHi }));
  for (const [code, l] of seen) if (!ordered.some((o) => o.code === code)) ordered.push({ code, name: l.name, nameHi: l.nameHi });
  return ordered.map((h) => ({ key: `h_${h.code}`, label: h.name, labelHi: h.nameHi, kind: "money" as const, total: true }));
}

const addTo = (row: Row, key: string, amount: number) => {
  row[key] = fromPaise(toPaise(Number(row[key] ?? 0)) + toPaise(amount));
};

/** One row per person for the month (regular and supplementary bills added together). */
async function byPerson(boardId: string, f: F, month = f.month) {
  const [slips, sections] = await Promise.all([salarySlips(boardId, f, month), sectionNames(boardId)]);
  const people = new Map<string, { s: SalarySlip; lines: PayLine[]; gross: number; deductions: number; net: number; employer: number; days: number | null }>();
  for (const s of slips) {
    const p = people.get(s.employeeId) ?? { s, lines: [], gross: 0, deductions: 0, net: 0, employer: 0, days: null };
    p.lines.push(...linesOf(s));
    p.gross += num(s.gross);
    p.deductions += num(s.deductions);
    p.net += num(s.net);
    p.employer += num(s.employer);
    if (s.run.kind === "REGULAR") p.days = s.workedDays !== null && s.employee.type === "DAILY_WAGE" ? num(s.workedDays) : num(s.daysOnRoll) - num(s.lossDays);
    people.set(s.employeeId, p);
  }
  return { slips, sections, people };
}

const personRow = (s: SalarySlip, sections: Map<string, { name: string; nameHi: string }>): Row => ({
  code: s.employee.employeeCode,
  name: nameOf(s.employee),
  nameHi: s.employee.nameHi ?? nameOf(s.employee),
  post: s.employee.post.name,
  postHi: s.employee.post.nameHi,
  section: sections.get(s.sectionId)?.name ?? "",
  sectionHi: sections.get(s.sectionId)?.nameHi ?? "",
  _href: `/employees/${s.employee.id}`,
});

const personCols: Col[] = [
  { key: "code", t: "reports.cols.code" },
  { key: "name", t: "reports.cols.name" },
  { key: "section", t: "reports.cols.section" },
];

const rs = (n: number) => formatINR(n);

export const PAYROLL_REPORTS: ReportDef[] = [
  {
    no: 11,
    key: "salary-register",
    area: "payroll",
    fn: "payroll",
    filters: ["month", "section", "type"],
    defaultMonth: "lastBill",
    async run(actor, f) {
      const [heads, { slips, sections, people }] = await Promise.all([headOrder(actor.boardId), byPerson(actor.boardId, f)]);
      const earn = headCols(heads, slips, "EARNING");
      const ded = headCols(heads, slips, "DEDUCTION");
      const rows = [...people.values()].map((p) => {
        const row: Row = { ...personRow(p.s, sections), days: p.days, gross: p.gross, deductions: p.deductions, net: p.net };
        for (const l of p.lines) if (l.kind !== "EMPLOYER") addTo(row, `h_${l.code}`, l.amount);
        return row;
      });
      return {
        columns: [
          ...personCols,
          { key: "post", t: "reports.cols.post" },
          { key: "days", t: "reports.cols.daysPaid", kind: "number" },
          ...earn,
          { key: "gross", t: "reports.cols.gross", kind: "money", total: true },
          ...ded,
          { key: "deductions", t: "reports.cols.deductions", kind: "money", total: true },
          { key: "net", t: "reports.cols.net", kind: "money", total: true },
        ],
        rows,
        note: { en: `Approved pay bills of ${formatMonth(f.month)}, regular and supplementary together. Pay withheld is not included.`, hi: `${formatMonth(f.month, "hi")} के स्वीकृत वेतन बिल, नियमित और पूरक साथ में। रोका गया वेतन शामिल नहीं।` },
      };
    },
  },
  {
    no: 12,
    key: "pay-bill",
    area: "payroll",
    fn: "payroll",
    filters: ["month", "section", "type"],
    defaultMonth: "lastBill",
    async run(actor, f) {
      const [heads, slips, runs] = await Promise.all([
        headOrder(actor.boardId),
        salarySlips(actor.boardId, f),
        db.payrollRun.findMany({ where: { boardId: actor.boardId, month: f.month, payGroup: { not: "PENSION" }, status: { in: [...PAID] } }, orderBy: [{ payGroup: "asc" }, { seq: "asc" }] }),
      ]);
      const totals = new Map<string, { line: PayLine; amount: number; people: Set<string> }>();
      for (const s of slips)
        for (const l of linesOf(s)) {
          if (l.amount === 0) continue;
          const t = totals.get(l.code) ?? { line: l, amount: 0, people: new Set<string>() };
          t.amount = fromPaise(toPaise(t.amount) + toPaise(l.amount));
          t.people.add(s.employeeId);
          totals.set(l.code, t);
        }
      const order = new Map(heads.map((h, i) => [h.code, i]));
      const kindOrder = { EARNING: 0, DEDUCTION: 1, EMPLOYER: 2 } as const;
      const rows: Row[] = [...totals.values()]
        .sort((a, b) => kindOrder[a.line.kind] - kindOrder[b.line.kind] || (order.get(a.line.code) ?? 999) - (order.get(b.line.code) ?? 999))
        .map((t) => ({ kind: t.line.kind, head: t.line.name, headHi: t.line.nameHi, account: t.line.accountHead, people: t.people.size, earning: t.line.kind === "EARNING" ? t.amount : null, deduction: t.line.kind === "DEDUCTION" ? t.amount : null, employer: t.line.kind === "EMPLOYER" ? t.amount : null }));
      const gross = rows.reduce((a, r) => a + Number(r.earning ?? 0), 0);
      const deductions = rows.reduce((a, r) => a + Number(r.deduction ?? 0), 0);
      const links = runs.flatMap((r) => [
        { label: `Pay bill — ${titleOf(r)}`, labelHi: `वेतन बिल — ${titleOf(r, "hi")}`, href: `/api/v1/payroll/runs/${r.id}/print/paybill` },
        { label: `Schedules — ${titleOf(r)}`, labelHi: `अनुसूचियाँ — ${titleOf(r, "hi")}`, href: `/api/v1/payroll/runs/${r.id}/print/schedules` },
      ]);
      return {
        columns: [
          { key: "kind", t: "reports.cols.kind", enumKey: "payroll.kinds" },
          { key: "head", t: "reports.cols.head" },
          { key: "account", t: "reports.cols.accountHead" },
          { key: "people", t: "reports.cols.people", kind: "number" },
          { key: "earning", t: "reports.cols.earnings", kind: "money", total: true },
          { key: "deduction", t: "reports.cols.deductions", kind: "money", total: true },
          { key: "employer", t: "reports.cols.employerShare", kind: "money", total: true },
        ],
        rows,
        links,
        note: { en: `Abstract by head of ${runs.length} approved ${runs.length === 1 ? "bill" : "bills"}: gross ${rs(gross)}, deductions ${rs(deductions)}, net ${rs(gross - deductions)}. The printed bills and schedules are linked below.`, hi: `${runs.length} स्वीकृत ${runs.length === 1 ? "बिल" : "बिलों"} का मदवार सार: सकल ${rs(gross)}, कटौतियाँ ${rs(deductions)}, शुद्ध ${rs(gross - deductions)}। छपे बिल और अनुसूचियाँ नीचे जुड़ी हैं।` },
      };
    },
  },
  {
    no: 13,
    key: "acquittance",
    area: "payroll",
    fn: "payroll",
    filters: ["month", "section", "type"],
    defaultMonth: "lastBill",
    async run(actor, f) {
      const [slips, sections] = await Promise.all([salarySlips(actor.boardId, f), sectionNames(actor.boardId)]);
      const rows: Row[] = slips
        .map((s): Row => ({
          ...personRow(s, sections),
          bill: titleOf(s.run),
          billHi: titleOf(s.run, "hi"),
          net: num(s.net),
          bank: s.bankLast4 ? `${s.ifsc ?? ""} ····${s.bankLast4}` : null,
          credit: s.creditStatus ?? (s.run.status === "APPROVED" ? null : "CREDITED"),
          _tone: s.creditStatus === "FAILED" ? ("red" as const) : null,
        }))
        .sort((a, b) => String(a.section).localeCompare(String(b.section)) || String(a.code).localeCompare(String(b.code)));
      return {
        columns: [...personCols, { key: "post", t: "reports.cols.post" }, { key: "bill", t: "reports.cols.bill" }, { key: "net", t: "reports.cols.net", kind: "money", total: true }, { key: "bank", t: "reports.cols.bankAccount" }, { key: "credit", t: "reports.cols.credit", enumKey: "payroll.credit" }],
        rows,
        note: { en: "Net pay credited to each person's bank account, section by section. A blank credit column means the bank file is not out yet.", hi: "प्रत्येक व्यक्ति के बैंक खाते में जमा शुद्ध वेतन, अनुभागवार। जमा कॉलम खाली होने का अर्थ है बैंक फ़ाइल अभी नहीं गई।" },
      };
    },
  },
  {
    no: 14,
    key: "salary-cost",
    area: "payroll",
    fn: "payroll",
    filters: ["month", "section", "type"],
    defaultMonth: "lastBill",
    async run(actor, f) {
      const [heads, slips, sections] = await Promise.all([headOrder(actor.boardId), salarySlips(actor.boardId, f), sectionNames(actor.boardId)]);
      const earn = headCols(heads, slips, "EARNING");
      const by = new Map<string, Row>();
      const seen = new Map<string, Set<string>>();
      for (const s of slips) {
        const sec = sections.get(s.sectionId);
        const row = by.get(s.sectionId) ?? ({ section: sec?.name ?? "", sectionHi: sec?.nameHi ?? "", people: 0, gross: 0, employer: 0, cost: 0 } as Row);
        const people = seen.get(s.sectionId) ?? new Set<string>();
        people.add(s.employeeId);
        seen.set(s.sectionId, people);
        row.people = people.size;
        for (const l of linesOf(s)) if (l.kind === "EARNING") addTo(row, `h_${l.code}`, l.amount);
        addTo(row, "gross", num(s.gross));
        addTo(row, "employer", num(s.employer));
        addTo(row, "cost", num(s.gross) + num(s.employer));
        by.set(s.sectionId, row);
      }
      return {
        columns: [
          { key: "section", t: "reports.cols.section" },
          { key: "people", t: "reports.cols.people", kind: "number", total: true },
          ...earn,
          { key: "gross", t: "reports.cols.gross", kind: "money", total: true },
          { key: "employer", t: "reports.cols.employerShare", kind: "money", total: true },
          { key: "cost", t: "reports.cols.cost", kind: "money", total: true },
        ],
        rows: [...by.values()].sort((a, b) => String(a.section).localeCompare(String(b.section))),
        note: { en: "Cost to the Board: gross pay plus the Board's own contributions (NPS, EPF, ESIC, pension fund).", hi: "बोर्ड पर लागत: सकल वेतन और बोर्ड का अपना अंशदान (एनपीएस, ईपीएफ, ईएसआईसी, पेंशन निधि)।" },
      };
    },
  },
  {
    no: 15,
    key: "month-change",
    area: "payroll",
    fn: "payroll",
    filters: ["month", "section", "type"],
    defaultMonth: "lastBill",
    async run(actor, f) {
      const [now, before] = await Promise.all([byPerson(actor.boardId, f), byPerson(actor.boardId, f, previous(f.month))]);
      const ids = new Set([...now.people.keys(), ...before.people.keys()]);
      const rows: Row[] = [];
      for (const id of ids) {
        const a = before.people.get(id);
        const b = now.people.get(id);
        const was = a?.net ?? 0;
        const is = b?.net ?? 0;
        const diff = fromPaise(toPaise(is) - toPaise(was));
        if (Math.abs(diff) < 1) continue;
        // Which heads moved, so the change explains itself (DA +1,200 · HRA +300).
        const sum = (lines: PayLine[] | undefined) => {
          const m = new Map<string, { name: string; nameHi: string; v: number }>();
          for (const l of lines ?? []) {
            if (l.kind === "EMPLOYER") continue;
            const sign = l.kind === "DEDUCTION" ? -1 : 1;
            const x = m.get(l.code) ?? { name: l.code, nameHi: l.code, v: 0 };
            x.v += sign * l.amount;
            m.set(l.code, x);
          }
          return m;
        };
        const ma = sum(a?.lines);
        const mb = sum(b?.lines);
        const moved = [...new Set([...ma.keys(), ...mb.keys()])]
          .map((code) => ({ code, d: Math.round((mb.get(code)?.v ?? 0) - (ma.get(code)?.v ?? 0)) }))
          .filter((x) => x.d !== 0)
          .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
          .slice(0, 4)
          .map((x) => `${x.code} ${x.d > 0 ? "+" : "−"}${formatINR(Math.abs(x.d), { symbol: false })}`)
          .join(" · ");
        const s = (b ?? a)!.s;
        const why = !a ? "NEW" : !b ? "GONE" : null;
        rows.push({ ...personRow(s, b ? now.sections : before.sections), was, is, diff, pct: was ? Math.round((diff / was) * 1000) / 10 : null, why, moved, _tone: why === "GONE" ? "amber" : Math.abs(diff) > Math.max(5000, was * 0.2) ? "red" : null });
      }
      return {
        columns: [
          ...personCols,
          { key: "was", t: "reports.cols.lastMonth", kind: "money", total: true },
          { key: "is", t: "reports.cols.thisMonth", kind: "money", total: true },
          { key: "diff", t: "reports.cols.change", kind: "money", total: true },
          { key: "pct", t: "reports.cols.changePct", kind: "number" },
          { key: "why", t: "reports.cols.note", enumKey: "reports.changeWhy" },
          { key: "moved", t: "reports.cols.headsMoved" },
        ],
        rows: rows.sort((x, y) => Math.abs(y.diff as number) - Math.abs(x.diff as number)),
        note: { en: `Net pay of ${formatMonth(f.month)} against ${formatMonth(previous(f.month))}, for everyone whose pay changed by a rupee or more. Red: a change of more than 20% (and ₹5,000).`, hi: `${formatMonth(f.month, "hi")} का शुद्ध वेतन ${formatMonth(previous(f.month), "hi")} के मुकाबले, उन सबके लिए जिनका वेतन एक रुपये या अधिक बदला। लाल: 20% (और ₹5,000) से अधिक बदलाव।` },
      };
    },
  },
  {
    no: 16,
    key: "deductions",
    area: "payroll",
    fn: "payroll",
    filters: ["month", "section", "type"],
    defaultMonth: "lastBill",
    async run(actor, f) {
      const [heads, slips] = await Promise.all([headOrder(actor.boardId), salarySlips(actor.boardId, f)]);
      const by = new Map<string, Row>();
      const seen = new Map<string, Set<string>>();
      for (const s of slips)
        for (const l of linesOf(s)) {
          if (l.kind !== "DEDUCTION" || l.amount === 0) continue;
          const row = by.get(l.code) ?? ({ code: l.code, head: l.name, headHi: l.nameHi, account: l.accountHead, people: 0, OPS: 0, NPS: 0, CONTRACT: 0, total: 0 } as Row);
          const people = seen.get(l.code) ?? new Set<string>();
          people.add(s.employeeId);
          seen.set(l.code, people);
          row.people = people.size;
          addTo(row, s.run.payGroup, l.amount);
          addTo(row, "total", l.amount);
          by.set(l.code, row);
        }
      const order = new Map(heads.map((h, i) => [h.code, i]));
      return {
        columns: [
          { key: "head", t: "reports.cols.head" },
          { key: "account", t: "reports.cols.accountHead" },
          { key: "people", t: "reports.cols.people", kind: "number" },
          { key: "OPS", t: "reports.groups.OPS", kind: "money", total: true },
          { key: "NPS", t: "reports.groups.NPS", kind: "money", total: true },
          { key: "CONTRACT", t: "reports.groups.CONTRACT", kind: "money", total: true },
          { key: "total", t: "reports.cols.total", kind: "money", total: true },
        ],
        rows: [...by.values()].sort((a, b) => (order.get(String(a.code)) ?? 999) - (order.get(String(b.code)) ?? 999)),
        note: { en: "Every recovery from pay by head and pay group — what goes to each account (GPF, NPS, income tax, loans, society…).", hi: "वेतन से हर वसूली, मद और वेतन समूह अनुसार — हर खाते में क्या जाता है (जीपीएफ, एनपीएस, आयकर, ऋण, सोसाइटी…)।" },
      };
    },
  },
  {
    no: 17,
    key: "loans",
    area: "payroll",
    fn: "arrears_loans",
    filters: ["month", "section", "type"],
    async run(actor, f) {
      const section = sectionOf(f);
      const [loans, sections] = await Promise.all([
        db.loan.findMany({
          where: { boardId: actor.boardId, status: { in: ["RUNNING", "CLOSED"] }, startMonth: { lte: shiftMonth(f.month, 1) }, OR: [{ closedMonth: null }, { closedMonth: { gte: f.month } }], employee: { ...(section ? { sectionId: section } : {}), ...(f.type ? { type: f.type } : {}) } },
          include: { recoveries: true, employee: { select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, sectionId: true } } },
          orderBy: [{ employee: { employeeCode: "asc" } }, { sanctionDate: "asc" }],
        }),
        sectionNames(actor.boardId),
      ]);
      const rows: Row[] = [];
      for (const l of loans) {
        const terms = { principal: num(l.principal), interestRate: num(l.interestRate), instalmentAmount: num(l.instalmentAmount), startMonth: l.startMonth };
        const rec = l.recoveries.filter((r) => r.month <= f.month).map((r) => ({ month: r.month, principal: num(r.principal), interest: num(r.interest) }));
        // The position after the chosen month's recovery: what the next month starts from.
        const pos = loanPosition(terms, rec, shiftMonth(f.month, 1));
        if (pos.closed && l.status === "CLOSED" && (l.closedMonth ?? "") < f.month) continue;
        const left = pos.principalLeft + pos.interestLeft;
        const sec = sections.get(l.employee.sectionId);
        rows.push({
          code: l.employee.employeeCode,
          name: nameOf(l.employee),
          nameHi: l.employee.nameHi ?? nameOf(l.employee),
          section: sec?.name ?? "",
          sectionHi: sec?.nameHi ?? "",
          type: l.type,
          sanctioned: toISODate(l.sanctionDate),
          principal: terms.principal,
          instalment: terms.instalmentAmount,
          recovered: fromPaise(rec.reduce((a, r) => a + toPaise(r.principal) + toPaise(r.interest), 0)),
          principalLeft: pos.principalLeft,
          interestLeft: pos.interestLeft,
          left,
          instalmentsLeft: left > 0 ? Math.ceil(left / terms.instalmentAmount) : 0,
          _href: `/payroll/loans/${l.id}`,
        });
      }
      return {
        columns: [
          ...personCols,
          { key: "type", t: "reports.cols.loanType", enumKey: "payroll.loans.types" },
          { key: "sanctioned", t: "reports.cols.sanctionedOn", kind: "date" },
          { key: "principal", t: "reports.cols.principal", kind: "money", total: true },
          { key: "instalment", t: "reports.cols.instalment", kind: "money" },
          { key: "recovered", t: "reports.cols.recovered", kind: "money", total: true },
          { key: "principalLeft", t: "reports.cols.principalLeft", kind: "money", total: true },
          { key: "interestLeft", t: "reports.cols.interestLeft", kind: "money", total: true },
          { key: "left", t: "reports.cols.outstanding", kind: "money", total: true },
          { key: "instalmentsLeft", t: "reports.cols.instalmentsLeft", kind: "number" },
        ],
        rows,
        note: { en: `Loans and advances as they stand after the recovery of ${formatMonth(f.month)}. Interest is recovered after the principal.`, hi: `${formatMonth(f.month, "hi")} की वसूली के बाद ऋण और अग्रिम की स्थिति। ब्याज मूलधन के बाद वसूला जाता है।` },
      };
    },
  },
  {
    no: 18,
    key: "arrears",
    area: "payroll",
    fn: "arrears_loans",
    filters: ["month", "section", "type"],
    defaultMonth: "lastBill",
    async run(actor, f) {
      const [slips, sections] = await Promise.all([salarySlips(actor.boardId, f, f.month, { run: { kind: "SUPPLEMENTARY", status: { in: [...PAID] }, payGroup: { not: "PENSION" } } }), sectionNames(actor.boardId)]);
      const rows: Row[] = [];
      for (const s of slips) {
        const months = (s.detail as { arrears?: ArrearMonth[] } | null)?.arrears;
        if (!months?.length) continue;
        for (const m of months) {
          const sum = (k: "due" | "drawn" | "diff", kind: PayLine["kind"]) => fromPaise(m.lines.filter((l) => l.kind === kind).reduce((a, l) => a + toPaise(l[k]), 0));
          const diff = sum("diff", "EARNING");
          if (diff === 0 && sum("diff", "DEDUCTION") === 0) continue;
          rows.push({
            ...personRow(s, sections),
            bill: titleOf(s.run),
            billHi: titleOf(s.run, "hi"),
            forMonth: m.month,
            due: sum("due", "EARNING"),
            drawn: sum("drawn", "EARNING"),
            diff,
            dedDiff: sum("diff", "DEDUCTION"),
            net: fromPaise(toPaise(diff) - toPaise(sum("diff", "DEDUCTION"))),
            heads: m.lines.filter((l) => l.diff !== 0 && l.kind === "EARNING").map((l) => `${l.code} ${formatINR(l.diff, { symbol: false })}`).join(" · "),
          });
        }
      }
      return {
        columns: [
          ...personCols,
          { key: "forMonth", t: "reports.cols.forMonth", kind: "month" },
          { key: "due", t: "reports.cols.due", kind: "money", total: true },
          { key: "drawn", t: "reports.cols.drawn", kind: "money", total: true },
          { key: "diff", t: "reports.cols.arrears", kind: "money", total: true },
          { key: "dedDiff", t: "reports.cols.deductions", kind: "money", total: true },
          { key: "net", t: "reports.cols.net", kind: "money", total: true },
          { key: "heads", t: "reports.cols.headsMoved" },
          { key: "bill", t: "reports.cols.bill" },
        ],
        rows,
        note: { en: `Arrears paid in supplementary bills approved for ${formatMonth(f.month)}: due against drawn, month by month.`, hi: `${formatMonth(f.month, "hi")} के स्वीकृत पूरक बिलों में दिया गया बकाया: देय बनाम आहरित, माहवार।` },
      };
    },
  },
  {
    no: 19,
    key: "bank-credits",
    area: "payroll",
    fn: "payroll",
    filters: ["month", "section", "type"],
    defaultMonth: "lastBill",
    async run(actor, f) {
      const [slips, sections] = await Promise.all([salarySlips(actor.boardId, f), sectionNames(actor.boardId)]);
      const sent = slips.filter((s) => s.run.status !== "APPROVED");
      const count = (st: string | null) => sent.filter((s) => s.creditStatus === st);
      const sum = (list: SalarySlip[]) => list.reduce((a, s) => a + num(s.net), 0);
      const failed = count("FAILED");
      const repaid = count("REPAID");
      const rows: Row[] = [...failed, ...repaid].map((s) => ({
        ...personRow(s, sections),
        bill: titleOf(s.run),
        billHi: titleOf(s.run, "hi"),
        net: num(s.net),
        bank: s.bankLast4 ? `${s.ifsc ?? ""} ····${s.bankLast4}` : null,
        credit: s.creditStatus,
        reason: s.creditNote,
        _tone: s.creditStatus === "FAILED" ? ("red" as const) : null,
      }));
      const waiting = slips.length - sent.length;
      return {
        columns: [...personCols, { key: "bill", t: "reports.cols.bill" }, { key: "net", t: "reports.cols.net", kind: "money", total: true }, { key: "bank", t: "reports.cols.bankAccount" }, { key: "credit", t: "reports.cols.credit", enumKey: "payroll.credit" }, { key: "reason", t: "reports.cols.reason" }],
        rows,
        note: {
          en: `${sent.length} credits sent (${rs(sum(sent))}); ${failed.length} failed (${rs(sum(failed))}); ${repaid.length} re-paid (${rs(sum(repaid))})${waiting ? `; ${waiting} approved but the bank file is not out yet` : ""}. Failed and re-paid credits are listed.`,
          hi: `${sent.length} जमा भेजे (${rs(sum(sent))}); ${failed.length} विफल (${rs(sum(failed))}); ${repaid.length} दोबारा भुगतान (${rs(sum(repaid))})${waiting ? `; ${waiting} स्वीकृत पर बैंक फ़ाइल अभी नहीं गई` : ""}। विफल और दोबारा भुगतान वाले जमा सूची में हैं।`,
        },
      };
    },
  },
];
