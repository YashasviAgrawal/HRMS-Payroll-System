import "server-only";
import { db } from "@/lib/db";
import { formatMonth, todayIST } from "@/lib/dates";
import { gpfYear, type GpfMove } from "@/modules/statutory/gpf-rules";
import { monthlyRate } from "@/modules/statutory/gpf";
import { fyOfMonth } from "@/modules/statutory/tax-rules";
import { tdsYear } from "@/modules/statutory/tds";
import { linesOf, nameOf, salarySlips, sectionNames, sectionOf } from "./common";
import { num, type Col, type ReportDef, type Row } from "./types";

/** Reports 20–23 (PRD §11, Statutory and tax): GPF accounts, NPS, EPF and ESIC from approved bills, TDS and 24Q. */

const personCols: Col[] = [
  { key: "code", t: "reports.cols.code" },
  { key: "name", t: "reports.cols.name" },
  { key: "section", t: "reports.cols.section" },
];

const sum = (lines: { code: string; amount: number }[], ...codes: string[]) => lines.filter((l) => codes.includes(l.code)).reduce((a, l) => a + l.amount, 0);

export const STATUTORY_REPORTS: ReportDef[] = [
  {
    no: 20,
    key: "gpf-ledger",
    area: "statutory",
    fn: "statutory",
    filters: ["month", "section"],
    async run(actor, f) {
      const fy = fyOfMonth(f.month);
      const section = sectionOf(f);
      const thisFy = fyOfMonth(todayIST().slice(0, 7));
      const [people, entries, rateFor, sections] = await Promise.all([
        db.employee.findMany({
          where: { boardId: actor.boardId, ...(section ? { sectionId: section } : {}), OR: [{ type: "PERMANENT_OPS", status: { in: ["ACTIVE", "SUSPENDED"] } }, { gpfEntries: { some: { fy: { lte: fy } } } }] },
          select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, gpfNumber: true, sectionId: true },
          orderBy: { employeeCode: "asc" },
        }),
        db.gpfEntry.findMany({ where: { boardId: actor.boardId, fy: { lte: fy } }, select: { employeeId: true, month: true, fy: true, kind: true, amount: true } }),
        monthlyRate(db, actor.boardId, "GPF_INTEREST"),
        sectionNames(actor.boardId),
      ]);
      const moves = new Map<string, GpfMove[]>();
      for (const e of entries) moves.set(e.employeeId, [...(moves.get(e.employeeId) ?? []), { month: e.month, fy: e.fy, kind: e.kind, amount: num(e.amount) }]);
      const rows: Row[] = [];
      for (const p of people) {
        const m = moves.get(p.id) ?? [];
        // This year's interest runs to the chosen month; a past year's to March (the annual statement).
        const y = gpfYear(m, fy, rateFor, fy === thisFy ? f.month : undefined);
        if (!m.length && y.opening === 0) continue;
        const sec = sections.get(p.sectionId);
        rows.push({
          code: p.employeeCode,
          name: nameOf(p),
          nameHi: p.nameHi ?? nameOf(p),
          section: sec?.name ?? "",
          sectionHi: sec?.nameHi ?? "",
          gpfNo: p.gpfNumber,
          opening: y.opening,
          credits: y.credits,
          debits: y.debits,
          interest: y.interest,
          credited: y.interestCredited,
          closing: y.interestCredited ? y.closing : y.closing + y.interest,
          _href: `/statutory/funds/${p.id}?fy=${fy}`,
        });
      }
      return {
        columns: [
          ...personCols,
          { key: "gpfNo", t: "reports.cols.gpfNo" },
          { key: "opening", t: "reports.cols.opening", kind: "money", total: true },
          { key: "credits", t: "reports.cols.subscriptions", kind: "money", total: true },
          { key: "debits", t: "reports.cols.withdrawals", kind: "money", total: true },
          { key: "interest", t: "reports.cols.interest", kind: "money", total: true },
          { key: "credited", t: "reports.cols.interestCredited", kind: "money", total: true },
          { key: "closing", t: "reports.cols.closing", kind: "money", total: true },
        ],
        rows,
        note: {
          en: `GPF accounts for ${fy}${fy === thisFy ? ` up to ${formatMonth(f.month)}` : ""}: subscriptions and refunds from approved bills, advances and withdrawals, interest on the monthly balance at the notified rate. Closing includes interest worked out but not yet credited. Open a person for the annual statement (PDF).`,
          hi: `${fy}${fy === thisFy ? ` ${formatMonth(f.month, "hi")} तक` : ""} के जीपीएफ खाते: स्वीकृत बिलों से अंशदान और वापसी, अग्रिम और निकासी, अधिसूचित दर पर मासिक शेष पर ब्याज। अंतिम शेष में गणना किया गया पर अभी जमा न हुआ ब्याज शामिल है। वार्षिक विवरण (पीडीएफ) के लिए व्यक्ति खोलें।`,
        },
      };
    },
  },
  {
    no: 21,
    key: "nps",
    area: "statutory",
    fn: "statutory",
    filters: ["month", "section"],
    defaultMonth: "lastBill",
    async run(actor, f) {
      const [slips, sections] = await Promise.all([salarySlips(actor.boardId, f, f.month, { payGroup: "NPS" }), sectionNames(actor.boardId)]);
      const by = new Map<string, Row>();
      for (const s of slips) {
        const lines = linesOf(s);
        const own = sum(lines, "NPS");
        const board = sum(lines, "NPS_ER");
        if (own + board === 0) continue;
        const sec = sections.get(s.sectionId);
        const r = by.get(s.employeeId) ?? { code: s.employee.employeeCode, name: nameOf(s.employee), nameHi: s.employee.nameHi ?? nameOf(s.employee), section: sec?.name ?? "", sectionHi: sec?.nameHi ?? "", pran: s.employee.pran, basicDa: 0, own: 0, board: 0, total: 0, _tone: (s.employee.pran ?? "").length === 12 ? null : ("red" as const), _href: `/statutory/funds/${s.employee.id}` };
        r.basicDa = (r.basicDa as number) + sum(lines, "BASIC", "DA", "NPA");
        r.own = (r.own as number) + own;
        r.board = (r.board as number) + board;
        r.total = (r.total as number) + own + board;
        by.set(s.employeeId, r);
      }
      return {
        columns: [
          ...personCols,
          { key: "pran", t: "reports.cols.pran" },
          { key: "basicDa", t: "reports.cols.basicDa", kind: "money", total: true },
          { key: "own", t: "reports.cols.employeeShare", kind: "money", total: true },
          { key: "board", t: "reports.cols.boardShare", kind: "money", total: true },
          { key: "total", t: "reports.cols.total", kind: "money", total: true },
        ],
        rows: [...by.values()],
        note: { en: `NPS contributions in the approved bills of ${formatMonth(f.month)} (what the CRA file uploads). Red: PRAN missing or wrong — that person cannot go in the file.`, hi: `${formatMonth(f.month, "hi")} के स्वीकृत बिलों में एनपीएस अंशदान (जो सीआरए फ़ाइल में जाता है)। लाल: पीआरएएन नहीं या गलत — वह व्यक्ति फ़ाइल में नहीं जा सकता।` },
      };
    },
  },
  {
    no: 22,
    key: "epf-esic",
    area: "statutory",
    fn: "statutory",
    filters: ["month", "section", "type"],
    defaultMonth: "lastBill",
    async run(actor, f) {
      const [slips, sections] = await Promise.all([salarySlips(actor.boardId, f, f.month, { payGroup: "CONTRACT" }), sectionNames(actor.boardId)]);
      const by = new Map<string, Row>();
      for (const s of slips) {
        const lines = linesOf(s);
        const sec = sections.get(s.sectionId);
        const r =
          by.get(s.employeeId) ??
          ({ code: s.employee.employeeCode, name: nameOf(s.employee), nameHi: s.employee.nameHi ?? nameOf(s.employee), section: sec?.name ?? "", sectionHi: sec?.nameHi ?? "", uan: s.employee.uan, esic: s.employee.esicNumber, wages: 0, epf: 0, epfEr: 0, esicEe: 0, esicEr: 0 } as Row);
        r.wages = (r.wages as number) + num(s.gross);
        r.epf = (r.epf as number) + sum(lines, "EPF");
        r.epfEr = (r.epfEr as number) + sum(lines, "EPF_ER");
        r.esicEe = (r.esicEe as number) + sum(lines, "ESIC");
        r.esicEr = (r.esicEr as number) + sum(lines, "ESIC_ER");
        by.set(s.employeeId, r);
      }
      const rows = [...by.values()]
        .filter((r) => (r.epf as number) + (r.epfEr as number) + (r.esicEe as number) + (r.esicEr as number) > 0)
        .map((r) => ({ ...r, _tone: ((r.epf as number) > 0 && String(r.uan ?? "").length !== 12) || ((r.esicEe as number) + (r.esicEr as number) > 0 && String(r.esic ?? "").length !== 10) ? ("red" as const) : null }));
      return {
        columns: [
          ...personCols,
          { key: "uan", t: "reports.cols.uan" },
          { key: "esic", t: "reports.cols.esicNo" },
          { key: "wages", t: "reports.cols.wages", kind: "money", total: true },
          { key: "epf", t: "reports.cols.epfEmployee", kind: "money", total: true },
          { key: "epfEr", t: "reports.cols.epfEmployer", kind: "money", total: true },
          { key: "esicEe", t: "reports.cols.esicEmployee", kind: "money", total: true },
          { key: "esicEr", t: "reports.cols.esicEmployer", kind: "money", total: true },
        ],
        rows,
        note: { en: `EPF and ESIC in the approved contract and daily-wage bills of ${formatMonth(f.month)}. Red: UAN or ESIC number missing.`, hi: `${formatMonth(f.month, "hi")} के स्वीकृत संविदा और दैनिक वेतन बिलों में ईपीएफ और ईएसआईसी। लाल: यूएएन या ईएसआईसी संख्या नहीं।` },
      };
    },
  },
  {
    no: 23,
    key: "tds-24q",
    area: "statutory",
    fn: "statutory",
    filters: ["month"],
    async run(actor, f) {
      const year = await tdsYear(actor, fyOfMonth(f.month));
      const rows: Row[] = year.months.map((m) => {
        const q = year.quarters.find((x) => x.months.includes(m.month))!;
        const last = q.months[2] === m.month;
        return {
          quarter: `Q${q.quarter}`,
          month: m.month,
          people: m.people,
          tds: m.tds,
          deposited: m.deposited,
          dueOn: m.dueOn,
          status: m.status,
          challans: m.challans.map((c) => `${c.bsrCode}/${c.challanNo}`).join(", ") || null,
          file: last ? (q.file ? q.file.status : q.ended ? "NOT_MADE" : null) : null,
          _tone: m.status === "OVERDUE" || m.status === "SHORT" ? ("red" as const) : m.status === "DUE" ? ("amber" as const) : null,
        };
      });
      const noPan = year.quarters.reduce((a, q) => a + q.noPan, 0);
      return {
        columns: [
          { key: "quarter", t: "reports.cols.quarter" },
          { key: "month", t: "reports.cols.month", kind: "month" },
          { key: "people", t: "reports.cols.people", kind: "number" },
          { key: "tds", t: "reports.cols.tds", kind: "money", total: true },
          { key: "deposited", t: "reports.cols.deposited", kind: "money", total: true },
          { key: "dueOn", t: "reports.cols.dueOn", kind: "date" },
          { key: "status", t: "reports.cols.status", enumKey: "statutory.tds.status" },
          { key: "challans", t: "reports.cols.challans" },
          { key: "file", t: "reports.cols.form24q", enumKey: "reports.fileState" },
        ],
        rows,
        note: {
          en: `TDS on salary and pension for ${year.fy}: deducted in approved bills against challans deposited, and each quarter's Form 24Q (shown on the quarter's last month).${noPan ? ` ${noPan} deductee(s) without PAN — TDS at the higher rate applies.` : ""} Section and type do not apply: challans are for the whole Board.`,
          hi: `${year.fy} के लिए वेतन और पेंशन पर टीडीएस: स्वीकृत बिलों में कटौती बनाम जमा चालान, और हर तिमाही का फ़ॉर्म 24Q (तिमाही के अंतिम माह में)।${noPan ? ` ${noPan} कटौतीधारक बिना पैन — ऊँची दर पर टीडीएस।` : ""} अनुभाग और प्रकार लागू नहीं: चालान पूरे बोर्ड के हैं।`,
        },
        links: [{ label: `TDS and Form 24Q — ${year.fy}`, labelHi: `टीडीएस और फ़ॉर्म 24Q — ${year.fy}`, href: `/statutory/tds?fy=${year.fy}` }],
      };
    },
  },
];
