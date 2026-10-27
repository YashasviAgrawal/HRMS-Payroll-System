import "server-only";
import { db } from "@/lib/db";
import { formatMonth, todayIST, toISODate } from "@/lib/dates";
import { fullName } from "@/modules/employees/present";
import { lcViewOf } from "@/modules/pension/pensioners";
import { monthBounds, sectionNames, sectionOf } from "./common";
import { PAID, num, type ReportDef, type Row } from "./types";

/** Report 24 (PRD §11, Pension): every pension running in the month, what the month's bill paid, and the life certificate. */
export const PENSION_REPORTS: ReportDef[] = [
  {
    no: 24,
    key: "pension-register",
    area: "pension",
    fn: "pension",
    filters: ["month", "section"],
    defaultMonth: "lastPension",
    async run(actor, f) {
      const { start, end } = monthBounds(f.month);
      const section = sectionOf(f);
      const [pensioners, sections] = await Promise.all([
        db.pensioner.findMany({
          where: { boardId: actor.boardId, startDate: { lte: end }, OR: [{ endDate: null }, { endDate: { gte: start } }], ...(section ? { employee: { sectionId: section } } : {}) },
          include: { employee: { select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, sectionId: true } }, lifeCertificates: { select: { certifiedOn: true, status: true } } },
          orderBy: { ppoNumber: "asc" },
        }),
        sectionNames(actor.boardId),
      ]);
      const slips = await db.payslip.findMany({
        where: { boardId: actor.boardId, month: f.month, pensionerId: { in: pensioners.map((p) => p.id) }, run: { payGroup: "PENSION", status: { in: [...PAID] } } },
        select: { pensionerId: true, net: true, status: true, run: { select: { kind: true, source: true } } },
      });
      const paid = new Map<string, { net: number; held: boolean }>();
      for (const s of slips) {
        // Benefits bills (gratuity, commutation) are not the month's pension.
        if ((s.run.source as { type?: string } | null)?.type === "BENEFITS") continue;
        const x = paid.get(s.pensionerId!) ?? { net: 0, held: false };
        if (s.status === "WITHHELD") x.held = true;
        else x.net += num(s.net);
        paid.set(s.pensionerId!, x);
      }
      const today = todayIST();
      const rows: Row[] = pensioners.map((p) => {
        const lc = lcViewOf(p, today);
        const sec = sections.get(p.employee.sectionId);
        const m = paid.get(p.id);
        return {
          ppo: p.ppoNumber,
          payee: p.payeeName,
          payeeHi: p.payeeNameHi ?? p.payeeName,
          type: p.type,
          of: p.relation === "SELF" ? null : `${fullName(p.employee)} (${p.employee.employeeCode ?? ""})`,
          ofHi: p.relation === "SELF" ? null : `${p.employee.nameHi ?? fullName(p.employee)} (${p.employee.employeeCode ?? ""})`,
          section: sec?.name ?? "",
          sectionHi: sec?.nameHi ?? "",
          basic: num(p.basicPension),
          commuted: num(p.commutedAmount),
          paid: m?.net ?? 0,
          held: m?.held ? "HELD" : null,
          lastCert: lc.lastOn,
          validTill: lc.validTill,
          lc: p.status === "ACTIVE" ? lc.state : null,
          ended: p.endDate ? toISODate(p.endDate) : null,
          _href: `/pension/pensioners/${p.id}`,
          _tone: p.status === "ACTIVE" && (lc.state === "HELD" || lc.state === "OVERDUE") ? "red" : p.status === "ACTIVE" && lc.state === "DUE_SOON" ? "amber" : null,
        };
      });
      return {
        columns: [
          { key: "ppo", t: "reports.cols.ppo" },
          { key: "payee", t: "reports.cols.payee" },
          { key: "type", t: "reports.cols.pensionType", enumKey: "pension.types" },
          { key: "of", t: "reports.cols.familyOf" },
          { key: "section", t: "reports.cols.retiredFrom" },
          { key: "basic", t: "reports.cols.basicPension", kind: "money", total: true },
          { key: "commuted", t: "reports.cols.commuted", kind: "money", total: true },
          { key: "paid", t: "reports.cols.paidThisMonth", kind: "money", total: true },
          { key: "held", t: "reports.cols.held", enumKey: "reports.held" },
          { key: "lastCert", t: "reports.cols.lastCertificate", kind: "date" },
          { key: "validTill", t: "reports.cols.validTill", kind: "date" },
          { key: "lc", t: "reports.cols.lifeCertificate", enumKey: "pension.lc.state" },
          { key: "ended", t: "reports.cols.endedOn", kind: "date" },
        ],
        rows,
        note: { en: `Pensions running at some point of ${formatMonth(f.month)}, with the net paid by that month's pension bills and today's life certificate status.`, hi: `${formatMonth(f.month, "hi")} में किसी समय चल रही पेंशन, उस माह के पेंशन बिलों से दिया गया शुद्ध और आज की जीवन प्रमाण पत्र स्थिति।` },
      };
    },
  },
];
