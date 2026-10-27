import "server-only";
import { db } from "@/lib/db";
import { formatMonth, toISODate } from "@/lib/dates";
import { monthBounds, nameOf, previous, sectionNames, sectionOf } from "./common";
import { PAID, num, type ReportDef, type Row } from "./types";

/**
 * Report 25 (PRD §11, Control): the ghost-employee check — people sharing an Aadhaar, PAN or bank account; pay or pension
 * after retirement, leaving or death; and pay for someone with no attendance at all in the month the bill read.
 */
export const CONTROL_REPORTS: ReportDef[] = [
  {
    no: 25,
    key: "ghost-check",
    area: "control",
    fn: "payroll",
    filters: ["month", "section", "type"],
    defaultMonth: "lastBill",
    async run(actor, f) {
      const { start } = monthBounds(f.month);
      const section = sectionOf(f);
      const sections = await sectionNames(actor.boardId);
      const rows: Row[] = [];
      const who = (e: { id: string; employeeCode: string | null; firstName: string; middleName: string | null; lastName: string | null; nameHi: string | null; sectionId: string }) => ({
        code: e.employeeCode,
        name: nameOf(e),
        nameHi: e.nameHi ?? nameOf(e),
        section: sections.get(e.sectionId)?.name ?? "",
        sectionHi: sections.get(e.sectionId)?.nameHi ?? "",
        _href: `/employees/${e.id}`,
      });
      const pick = { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, sectionId: true, type: true, status: true, dateOfRetirement: true, exitDate: true, aadhaarHash: true, panHash: true, bankAccountHash: true } as const;

      // 1. Shared identity numbers among people on the rolls (a pair is listed if either is in the chosen section/type).
      // The database refuses these for current staff (EM-03), so this normally finds nothing — it is the proof.
      const onRolls = await db.employee.findMany({ where: { boardId: actor.boardId, status: { in: ["ACTIVE", "SUSPENDED"] } }, select: pick });
      const inScope = (e: { sectionId: string; type?: string }) => (!section || e.sectionId === section) && (!f.type || e.type === f.type);
      for (const [field, check] of [["aadhaarHash", "SAME_AADHAAR"], ["panHash", "SAME_PAN"], ["bankAccountHash", "SAME_BANK"]] as const) {
        const groups = new Map<string, typeof onRolls>();
        for (const e of onRolls) {
          const v = e[field];
          if (v) groups.set(v, [...(groups.get(v) ?? []), e]);
        }
        for (const g of groups.values()) {
          if (g.length < 2 || !g.some(inScope)) continue;
          for (const e of g) rows.push({ check, ...who(e), detail: g.filter((x) => x.id !== e.id).map((x) => `${x.employeeCode ?? "—"} ${nameOf(x)}`).join(", "), _tone: "red" });
        }
      }

      // 1b. Where the database cannot stop it: a bank account that receives a pension and a salary (of someone else), or
      // two pensions. A re-employed pensioner drawing both into their own account is not a finding.
      const pensions = await db.pensioner.findMany({
        where: { boardId: actor.boardId, status: "ACTIVE", bankAccountHash: { not: null } },
        select: { id: true, ppoNumber: true, payeeName: true, payeeNameHi: true, bankAccountHash: true, employeeId: true, employee: { select: { sectionId: true } } },
      });
      const staffByBank = new Map(onRolls.filter((e) => e.bankAccountHash).map((e) => [e.bankAccountHash!, e]));
      const pensionsByBank = new Map<string, typeof pensions>();
      for (const p of pensions) pensionsByBank.set(p.bankAccountHash!, [...(pensionsByBank.get(p.bankAccountHash!) ?? []), p]);
      const pensionRow = (p: (typeof pensions)[number]) => ({
        code: p.ppoNumber,
        name: p.payeeName,
        nameHi: p.payeeNameHi ?? p.payeeName,
        section: sections.get(p.employee.sectionId)?.name ?? "",
        sectionHi: sections.get(p.employee.sectionId)?.nameHi ?? "",
        _href: `/pension/pensioners/${p.id}`,
      });
      for (const [hash, list] of pensionsByBank) {
        const e = staffByBank.get(hash);
        const others = list.filter((p) => p.employeeId !== e?.id);
        if (e && others.length && (inScope(e) || (!f.type && others.some((p) => inScope({ sectionId: p.employee.sectionId }))))) {
          rows.push({ check: "BANK_WITH_PENSION", ...who(e), detail: others.map((p) => `${p.ppoNumber} ${p.payeeName}`).join(", "), _tone: "red" });
          for (const p of others) rows.push({ check: "BANK_WITH_PENSION", ...pensionRow(p), detail: `${e.employeeCode ?? "—"} ${nameOf(e)}`, _tone: "red" });
        }
        if (list.length > 1 && !f.type && list.some((p) => inScope({ sectionId: p.employee.sectionId })))
          for (const p of list) rows.push({ check: "SAME_BANK_PENSIONS", ...pensionRow(p), detail: list.filter((x) => x.id !== p.id).map((x) => `${x.ppoNumber} ${x.payeeName}`).join(", "), _tone: "red" });
      }

      // 2. Pay in a regular bill of the month after the person retired, left or died before the month began.
      const slips = await db.payslip.findMany({
        where: {
          boardId: actor.boardId,
          month: f.month,
          pensionerId: null,
          status: "INCLUDED",
          run: { kind: "REGULAR", status: { in: [...PAID] }, payGroup: { not: "PENSION" } },
          ...(section ? { sectionId: section } : {}),
          ...(f.type ? { employee: { type: f.type } } : {}),
        },
        select: { employeeId: true, net: true, daysOnRoll: true, employee: { select: pick } },
      });
      for (const s of slips) {
        const e = s.employee;
        const gone = e.exitDate && e.exitDate < start ? toISODate(e.exitDate) : null;
        const retired = e.type !== "REEMPLOYED" && e.dateOfRetirement && e.dateOfRetirement < start ? toISODate(e.dateOfRetirement) : null;
        if (num(s.net) > 0 && (gone || retired)) rows.push({ check: e.status === "DECEASED" ? "PAID_AFTER_DEATH" : "PAID_AFTER_EXIT", ...who(e), detail: `${gone ?? retired} · ${e.status}`, amount: num(s.net), _tone: "red" });
      }

      // 3. Pay with no attendance: on the rolls the whole of last month (which this bill read) but not a day present, on duty or on leave.
      const att = await db.attendanceMonth.findMany({ where: { boardId: actor.boardId, month: previous(f.month), employeeId: { in: slips.map((s) => s.employeeId) } } });
      const attBy = new Map(att.map((a) => [a.employeeId, a]));
      for (const s of slips) {
        const a = attBy.get(s.employeeId);
        if (!a || num(s.net) <= 0 || a.daysOnRoll === 0) continue;
        if (num(a.present) + a.late + a.onDuty + num(a.leave) + a.halfDays === 0) rows.push({ check: "NO_ATTENDANCE", ...who(s.employee), detail: `${formatMonth(previous(f.month))}: ${a.daysOnRoll} · ${num(a.diesNon)}`, amount: num(s.net), _tone: "amber" });
      }

      // 4. Pension paid for a month that began after the pension ended (death of the pensioner).
      if (!f.type) {
        const pslips = await db.payslip.findMany({
          where: { boardId: actor.boardId, month: f.month, pensionerId: { not: null }, status: "INCLUDED", run: { kind: "REGULAR", payGroup: "PENSION", status: { in: [...PAID] } }, ...(section ? { sectionId: section } : {}) },
          select: { pensionerId: true, net: true, employee: { select: pick } },
        });
        const ended = new Map((await db.pensioner.findMany({ where: { id: { in: pslips.map((p) => p.pensionerId!) }, endDate: { lt: start } }, select: { id: true, ppoNumber: true, payeeName: true, endDate: true } })).map((p) => [p.id, p]));
        for (const s of pslips) {
          const p = ended.get(s.pensionerId!);
          if (p && num(s.net) > 0) rows.push({ check: "PENSION_AFTER_END", ...who(s.employee), detail: `${p.ppoNumber} ${p.payeeName} · ${toISODate(p.endDate!)}`, amount: num(s.net), _tone: "red", _href: `/pension/pensioners/${p.id}` });
        }
      }

      return {
        columns: [
          { key: "check", t: "reports.cols.finding", enumKey: "reports.ghost" },
          { key: "code", t: "reports.cols.code" },
          { key: "name", t: "reports.cols.name" },
          { key: "section", t: "reports.cols.section" },
          { key: "detail", t: "reports.cols.detail" },
          { key: "amount", t: "reports.cols.net", kind: "money", total: true },
        ],
        rows,
        note: {
          en: `Checks on the people on the rolls and the running pensions today, and the approved bills of ${formatMonth(f.month)}. The system already refuses the same Aadhaar, PAN or bank account for two current staff; here it also looks for an account that takes a salary and someone else's pension, or two pensions. "No attendance" reads ${formatMonth(previous(f.month))}, the month whose attendance the bill used. An empty report means nothing was found.`,
          hi: `आज के कर्मचारियों और चालू पेंशनों, और ${formatMonth(f.month, "hi")} के स्वीकृत बिलों की जाँच। दो वर्तमान कर्मचारियों के लिए एक ही आधार, पैन या बैंक खाता प्रणाली पहले ही नहीं लेती; यहाँ वह ऐसा खाता भी देखती है जिसमें वेतन और किसी और की पेंशन, या दो पेंशन आती हों। "बिना उपस्थिति" ${formatMonth(previous(f.month), "hi")} देखता है, जिस माह की उपस्थिति बिल ने ली। खाली रिपोर्ट का अर्थ है कुछ नहीं मिला।`,
        },
      };
    },
  },
];
