import "server-only";
import { db } from "@/lib/db";
import { maxDate, minDate, toISODate } from "@/lib/dates";
import { STATUS_CODE, weeklyOffFor } from "@/modules/attendance/rules";
import { attendanceRules, gazettedHolidays, sectionRegister, visibleSections } from "@/modules/attendance/service";
import { leaveRules } from "@/modules/leave/balance";
import { hasBalance, leaveDates } from "@/modules/leave/rules";
import { monthBounds, nameOf, onRollsWhere, sectionOf } from "./common";
import type { Col, ReportDef, ReportFilters, Row } from "./types";
import type { Actor } from "@/lib/auth/session";

/** Reports 7–10 (PRD §11, Attendance and leave): read from the same register and leave account the screens use. */

/** Every section register of the month the report covers (one section for a reporting officer or when one is picked). */
async function registers(actor: Actor, f: ReportFilters & { scopeSectionId: string | null }) {
  const section = sectionOf(f);
  const sections = section ? [{ id: section }] : await visibleSections(actor);
  const out = [];
  for (const s of sections) out.push(await sectionRegister(actor, s.id, f.month));
  return out;
}

const personCols: Col[] = [
  { key: "code", t: "reports.cols.code" },
  { key: "name", t: "reports.cols.name" },
  { key: "section", t: "reports.cols.section" },
];

export const ATTENDANCE_REPORTS: ReportDef[] = [
  {
    no: 7,
    key: "attendance-register",
    area: "attendance",
    fn: "attendance",
    filters: ["month", "section", "type"],
    async run(actor, f) {
      const regs = await registers(actor, f);
      const dates = regs[0]?.dates ?? [];
      const rows: Row[] = [];
      for (const r of regs)
        for (const p of r.rows) {
          if (f.type && p.employee.type !== f.type) continue;
          const row: Row = { code: p.employee.code, name: p.employee.name, nameHi: p.employee.nameHi ?? p.employee.name, section: r.section.name, sectionHi: r.section.nameHi, _href: `/employees/${p.employee.id}` };
          for (const day of p.days) row[`d${day.date.slice(8)}`] = day.onRoll ? (day.status ? STATUS_CODE[day.status] : "") : "–";
          row.present = p.totals.present + p.totals.late + p.totals.onDuty;
          row.leave = p.totals.leave;
          row.absent = p.totals.absent;
          row.payable = p.totals.payableDays;
          rows.push(row);
        }
      return {
        columns: [
          ...personCols,
          ...dates.map((dt) => ({ key: `d${dt.slice(8)}`, label: String(Number(dt.slice(8))) })),
          { key: "present", t: "reports.cols.present", kind: "number" as const, total: true },
          { key: "leave", t: "reports.cols.leave", kind: "number" as const, total: true },
          { key: "absent", t: "reports.cols.absent", kind: "number" as const, total: true },
          { key: "payable", t: "reports.cols.payableDays", kind: "number" as const, total: true },
        ],
        rows,
        note: { en: "P present · L late · ½ half day · A absent · M missed punch · OD on duty · LV leave · H holiday · W weekly off · DN dies-non", hi: "P उपस्थित · L देर · ½ आधा दिन · A अनुपस्थित · M पंच छूटा · OD ड्यूटी पर · LV अवकाश · H अवकाश दिवस · W साप्ताहिक अवकाश · DN डाइज़-नॉन" },
      };
    },
  },
  {
    no: 8,
    key: "absent-late",
    area: "attendance",
    fn: "attendance",
    filters: ["month", "section", "type"],
    async run(actor, f) {
      const regs = await registers(actor, f);
      const rows: Row[] = [];
      for (const r of regs)
        for (const p of r.rows) {
          if (f.type && p.employee.type !== f.type) continue;
          const t = p.totals;
          if (t.absent + t.late + t.missedPunch + t.halfDays + t.diesNon === 0) continue;
          const datesOf = (...s: string[]) => p.days.filter((x) => x.onRoll && x.status && s.includes(x.status)).map((x) => Number(x.date.slice(8))).join(", ");
          rows.push({
            code: p.employee.code,
            name: p.employee.name,
            nameHi: p.employee.nameHi ?? p.employee.name,
            section: r.section.name,
            sectionHi: r.section.nameHi,
            absent: t.absent,
            absentDays: datesOf("ABSENT"),
            late: t.late,
            lateDays: datesOf("LATE"),
            half: t.halfDays,
            missed: t.missedPunch,
            diesNon: t.diesNon,
            _href: `/employees/${p.employee.id}`,
            _tone: t.absent >= 3 || t.diesNon > 0 ? "red" : null,
          });
        }
      return {
        columns: [
          ...personCols,
          { key: "absent", t: "reports.cols.absent", kind: "number", total: true },
          { key: "absentDays", t: "reports.cols.onDates" },
          { key: "late", t: "reports.cols.late", kind: "number", total: true },
          { key: "lateDays", t: "reports.cols.onDates" },
          { key: "half", t: "reports.cols.halfDays", kind: "number", total: true },
          { key: "missed", t: "reports.cols.missedPunch", kind: "number", total: true },
          { key: "diesNon", t: "reports.cols.diesNon", kind: "number", total: true },
        ],
        rows: rows.sort((a, b) => (b.absent as number) - (a.absent as number) || (b.late as number) - (a.late as number)),
        note: { en: "Only people with an absence, late arrival, half day, missed punch or dies-non in the month.", hi: "केवल वे लोग जिनकी माह में अनुपस्थिति, देरी, आधा दिन, छूटा पंच या डाइज़-नॉन है।" },
      };
    },
  },
  {
    no: 9,
    key: "leave-balances",
    area: "attendance",
    fn: "leave",
    filters: ["month", "section", "type"],
    async run(actor, f) {
      const { end } = monthBounds(f.month);
      const [rules, people] = await Promise.all([
        leaveRules(actor.boardId),
        db.employee.findMany({
          where: { ...onRollsWhere(actor.boardId, f), status: { in: ["ACTIVE", "SUSPENDED"] } },
          select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, type: true, gender: true, section: { select: { name: true, nameHi: true } } },
          orderBy: { employeeCode: "asc" },
        }),
      ]);
      const kinds = rules.filter((r) => r.isActive && hasBalance(r));
      const sums = await db.leaveLedger.groupBy({ by: ["employeeId", "leaveCode"], where: { boardId: actor.boardId, employeeId: { in: people.map((p) => p.id) }, date: { lte: end } }, _sum: { days: true } });
      const bal = new Map(sums.map((s) => [`${s.employeeId}|${s.leaveCode}`, Number(s._sum.days ?? 0)]));
      const rows: Row[] = people.map((p) => {
        const row: Row = { code: p.employeeCode, name: nameOf(p), nameHi: p.nameHi ?? nameOf(p), section: p.section.name, sectionHi: p.section.nameHi, _href: `/leave/ledger/${p.id}` };
        for (const k of kinds) row[k.code] = k.employeeTypes.length && !k.employeeTypes.includes(p.type) ? null : (bal.get(`${p.id}|${k.code}`) ?? 0);
        return row;
      });
      return {
        columns: [...personCols, ...kinds.map((k) => ({ key: k.code, label: k.name, labelHi: k.nameHi, kind: "number" as const }))],
        rows,
        note: { en: "Balance in days at the end of the chosen month, from each person's leave account.", hi: "चुने माह के अंत में शेष दिन, प्रत्येक व्यक्ति के अवकाश खाते से।" },
      };
    },
  },
  {
    no: 10,
    key: "leave-taken",
    area: "attendance",
    fn: "leave",
    filters: ["month", "section", "type"],
    async run(actor, f) {
      const { from, to, start, end } = monthBounds(f.month);
      const section = sectionOf(f);
      const [rules, attRules, holidays, apps] = await Promise.all([
        leaveRules(actor.boardId),
        attendanceRules(actor.boardId),
        gazettedHolidays(actor.boardId, from, to),
        db.leaveApplication.findMany({ where: { boardId: actor.boardId, status: "APPROVED", fromDate: { lte: end }, toDate: { gte: start } } }),
      ]);
      const people = new Map(
        (
          await db.employee.findMany({
            where: { boardId: actor.boardId, id: { in: [...new Set(apps.map((a) => a.employeeId))] }, ...(section ? { sectionId: section } : {}), ...(f.type ? { type: f.type } : {}) },
            select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, section: { select: { name: true, nameHi: true, weeklyOff: true } } },
          })
        ).map((e) => [e.id, e]),
      );
      const rule = new Map(rules.map((r) => [r.code, r]));
      const holidaySet = new Set([...holidays.keys()]);
      const used = new Set<string>();
      const by = new Map<string, Row>();
      for (const a of apps) {
        const e = people.get(a.employeeId);
        if (!e) continue;
        const r = rule.get(a.leaveCode);
        const a0 = toISODate(a.fromDate);
        const a1 = toISODate(a.toDate);
        // Days inside the month under the leave's own counting rule (a leave crossing the month end is split).
        const days = a.halfDay ? 0.5 : a0 >= from && a1 <= to ? Number(a.days) : leaveDates({ from: maxDate(a0, from), to: minDate(a1, to), countsOffDays: r?.countsOffDays ?? true, holidays: holidaySet, weeklyOff: weeklyOffFor(e.section.weeklyOff, attRules.weeklyOff) }).length;
        const row = by.get(e.id) ?? ({ code: e.employeeCode, name: nameOf(e), nameHi: e.nameHi ?? nameOf(e), section: e.section.name, sectionHi: e.section.nameHi, total: 0, _href: `/leave/ledger/${e.id}` } as Row);
        row[a.leaveCode] = ((row[a.leaveCode] as number) ?? 0) + days;
        row.total = (row.total as number) + days;
        used.add(a.leaveCode);
        by.set(e.id, row);
      }
      const kinds = rules.filter((r) => used.has(r.code));
      return {
        columns: [...personCols, ...kinds.map((k) => ({ key: k.code, label: k.name, labelHi: k.nameHi, kind: "number" as const, total: true })), { key: "total", t: "reports.cols.total", kind: "number", total: true }],
        rows: [...by.values()].sort((a, b) => String(a.code).localeCompare(String(b.code))),
        note: { en: "Approved leave falling in the chosen month, in days, by leave type.", hi: "चुने माह में पड़ने वाला स्वीकृत अवकाश, दिनों में, अवकाश प्रकार अनुसार।" },
      };
    },
  },
];
