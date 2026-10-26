/**
 * Leave (Module 5): the default rules table for every installation, and demo balances and applications.
 * Uses only the pure leave rules so demo credits match what the app would credit.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import { addDays, datesOfMonth, formatDate, fromISODate, monthOf, shiftMonth, todayIST, weekday, type ISODate } from "../src/lib/dates";
import { LEAVE_DEFAULTS } from "../src/modules/leave/defaults";
import { cappedCredit, creditPeriod, isEligible, periodCredit } from "../src/modules/leave/rules";

/** The rules table from PRD §7. Existing rows are left alone: after the first load the table belongs to the Board. */
export async function seedLeaveTypes(db: PrismaClient, boardId: string) {
  for (const [i, d] of LEAVE_DEFAULTS.entries()) {
    await db.leaveType.upsert({
      where: { boardId_code: { boardId, code: d.code } },
      create: {
        boardId,
        code: d.code,
        name: d.name,
        nameHi: d.nameHi,
        pay: d.pay,
        creditMode: d.creditMode,
        creditDays: d.creditDays,
        cap: d.cap ?? null,
        lapsesAtYearEnd: d.lapsesAtYearEnd ?? false,
        debitFrom: d.debitFrom ?? null,
        debitFactor: d.debitFactor ?? 1,
        countsOffDays: d.countsOffDays ?? true,
        halfDayAllowed: d.halfDayAllowed ?? false,
        needsCertificate: d.needsCertificate ?? false,
        restrictedOnly: d.restrictedOnly ?? false,
        gender: d.gender ?? null,
        employeeTypes: d.employeeTypes,
        officerLimitDays: d.officerLimitDays ?? null,
        sortOrder: i,
      },
      update: {},
    });
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 1000;
}

interface Person {
  id: string;
  code: string;
  sectionId: string;
  doj: ISODate;
  gender: string;
  type: Parameters<typeof isEligible>[1]["type"];
}

/** Every credit period from 1 Jan 2026 up to today, oldest first. */
function periodsUpTo(today: ISODate) {
  const out: { mode: "HALF_YEARLY" | "YEARLY"; id: string; start: ISODate; end: ISODate }[] = [];
  for (let y = 2026; y <= Number(today.slice(0, 4)); y++) {
    out.push({ mode: "YEARLY", ...creditPeriod("YEARLY", `${y}-01-01`) });
    for (const h of [`${y}-01-01`, `${y}-07-01`]) if (h <= today) out.push({ mode: "HALF_YEARLY", ...creditPeriod("HALF_YEARLY", h) });
  }
  return out;
}

/**
 * Opening balances as on 31 Dec 2025, credits up to today, a few approved leaves (their days marked) and two
 * applications waiting: one for Health's reporting officer, one for an Admin (Education has no officer).
 */
export async function seedLeaveDemo(db: PrismaClient, boardId: string, people: Person[], users: Map<string, { id: string; name: string }>, hr: { id: string; name: string }) {
  if ((await db.leaveLedger.count({ where: { boardId } })) > 0) return;
  const types = await db.leaveType.findMany({ where: { boardId } });
  const rule = (code: string) => {
    const t = types.find((x) => x.code === code)!;
    return { ...t, creditDays: Number(t.creditDays), cap: t.cap === null ? null : Number(t.cap) };
  };
  const today = todayIST();
  const ledger: { boardId: string; employeeId: string; leaveCode: string; date: Date; kind: "OPENING" | "CREDIT" | "DEBIT"; days: number; period?: string; applicationId?: string; note: string }[] = [];
  const balance = new Map<string, number>();
  const add = (e: Person, code: string, days: number) => balance.set(`${e.id}|${code}`, (balance.get(`${e.id}|${code}`) ?? 0) + days);

  for (const e of people) {
    const h = hash(e.code);
    if (isEligible(rule("EL"), e) && e.doj < "2025-12-31") {
      const el = 30 + (h % 170);
      ledger.push({ boardId, employeeId: e.id, leaveCode: "EL", date: fromISODate("2025-12-31"), kind: "OPENING", days: el, period: "opening", note: "Opening balance as on 31 Dec 2025 (demo)" });
      add(e, "EL", el);
    }
    if (isEligible(rule("HPL"), e) && e.doj < "2025-12-31") {
      const hpl = 20 + ((h >> 3) % 120);
      ledger.push({ boardId, employeeId: e.id, leaveCode: "HPL", date: fromISODate("2025-12-31"), kind: "OPENING", days: hpl, period: "opening", note: "Opening balance as on 31 Dec 2025 (demo)" });
      add(e, "HPL", hpl);
    }
    for (const p of periodsUpTo(today)) {
      for (const t of types.filter((x) => x.creditMode === p.mode)) {
        const r = rule(t.code);
        if (!isEligible(r, e) || e.doj > p.end) continue;
        const due = periodCredit(r, e.doj, p);
        const credit = cappedCredit(due, balance.get(`${e.id}|${t.code}`) ?? 0, r.cap);
        ledger.push({ boardId, employeeId: e.id, leaveCode: t.code, date: fromISODate(e.doj > p.start ? e.doj : p.start), kind: "CREDIT", days: credit, period: p.id, note: `Credit for ${p.id}` });
        add(e, t.code, credit);
      }
    }
  }

  const byCode = new Map(people.map((p) => [p.code, p]));
  const lastMonth = shiftMonth(monthOf(today), -1);
  const workingIn = (month: string, from: number) => datesOfMonth(month).filter((d) => Number(d.slice(8)) >= from && weekday(d) >= 1 && weekday(d) <= 5);
  const upcoming = (n: number) => {
    const out: ISODate[] = [];
    for (let d = addDays(today, 7); out.length < n; d = addDays(d, 1)) if (weekday(d) >= 1 && weekday(d) <= 5) out.push(d);
    return out;
  };

  const leaves: { code: string; leave: string; dates: ISODate[]; status: "APPROVED" | "PENDING"; reason: string; decider?: "REPORTING_OFFICER" | "APPROVER" }[] = [
    { code: "DCB10005", leave: "EL", dates: workingIn(lastMonth, 14).slice(0, 3), status: "APPROVED", reason: "Daughter's school admission in Jaipur" },
    { code: "DCB10016", leave: "HPL", dates: workingIn(lastMonth, 21).slice(0, 2), status: "APPROVED", reason: "Viral fever" },
    { code: "DCB10019", leave: "CL", dates: workingIn(monthOf(today), 5).slice(0, 1), status: "APPROVED", reason: "Personal work at the bank" },
    { code: "DCB10010", leave: "CL", dates: upcoming(2), status: "PENDING", reason: "Village visit for a family function", decider: "REPORTING_OFFICER" },
    { code: "DCB10014", leave: "EL", dates: upcoming(5), status: "PENDING", reason: "Sister's wedding in Dehradun", decider: "APPROVER" },
  ];
  for (const l of leaves) {
    const e = byCode.get(l.code);
    if (!e || l.dates.length === 0) continue;
    const t = rule(l.leave);
    const from = l.dates[0];
    const to = l.dates.at(-1)!;
    const days = t.countsOffDays ? Math.round((fromISODate(to).getTime() - fromISODate(from).getTime()) / 86_400_000) + 1 : l.dates.length;
    const maker = users.get(l.code) ?? hr;
    const app = await db.leaveApplication.create({
      data: { boardId, employeeId: e.id, leaveCode: l.leave, fromDate: fromISODate(from), toDate: fromISODate(to), days, debitCode: l.leave, debitDays: days, reason: l.reason, status: l.status, createdById: maker.id, decidedAt: l.status === "APPROVED" ? new Date() : null },
    });
    if (l.status === "APPROVED") {
      ledger.push({ boardId, employeeId: e.id, leaveCode: l.leave, date: fromISODate(from), kind: "DEBIT", days: -days, applicationId: app.id, note: from === to ? `${l.leave} ${formatDate(from)}` : `${l.leave} ${formatDate(from)} – ${formatDate(to)}` });
      const all = t.countsOffDays ? Array.from({ length: days }, (_, i) => addDays(from, i)) : l.dates;
      for (const d of all) {
        await db.attendancePunch.deleteMany({ where: { employeeId: e.id, at: { gte: new Date(`${d}T00:00:00+05:30`), lt: new Date(`${addDays(d, 1)}T00:00:00+05:30`) } } });
        await db.attendanceDay.create({ data: { boardId, employeeId: e.id, date: fromISODate(d), status: "LEAVE", leaveCode: l.leave, source: "LEAVE", applicationId: app.id } });
      }
      continue;
    }
    const name = l.code === "DCB10010" ? ["Suresh Pal", "सुरेश पाल"] : ["Pooja Bhatia", "पूजा भाटिया"];
    const task = await db.approvalTask.create({
      data: {
        boardId,
        kind: "leave.apply",
        title: `${l.leave} ${days} day${days === 1 ? "" : "s"}: ${name[0]} · ${from.split("-").reverse().join("-")}`,
        titleHi: `${t.nameHi} ${days} दिन: ${name[1]} · ${from.split("-").reverse().join("-")}`,
        details: {
          rows: [
            { label: "Leave", labelHi: "अवकाश", new: `${t.name} (${t.code})` },
            { label: "Dates", labelHi: "तारीखें", new: `${formatDate(from)} – ${formatDate(to)}` },
            { label: "Days", labelHi: "दिन", new: String(days) },
            { label: `${l.leave} balance`, labelHi: `${l.leave} शेष`, old: String(balance.get(`${e.id}|${l.leave}`) ?? 0), new: String((balance.get(`${e.id}|${l.leave}`) ?? 0) - days) },
            { label: "Reason", labelHi: "कारण", new: l.reason },
          ],
          link: `/leave/applications/${app.id}`,
        },
        payload: { applicationId: app.id },
        requiredPermission: l.decider!,
        sectionId: l.decider === "REPORTING_OFFICER" ? e.sectionId : null,
        subjectEmployeeId: e.id,
        entityType: "LeaveApplication",
        entityId: app.id,
        makerId: maker.id,
        makerName: maker.name,
        makerNote: l.reason,
      },
    });
    await db.leaveApplication.update({ where: { id: app.id }, data: { taskId: task.id } });
  }
  await db.leaveLedger.createMany({ data: ledger, skipDuplicates: true });
}
