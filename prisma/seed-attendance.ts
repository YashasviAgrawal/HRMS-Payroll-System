/**
 * Demo attendance (Module 4): the year's holidays, section working weeks, a registered device, punches for
 * last month and this month, a muster-roll section, last month locked for every section except Health
 * (left for its reporting officer to lock), and a missed-punch request waiting for that officer.
 *
 * Uses only the pure attendance rules, so the totals frozen here are the ones the app would freeze.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import type { DayStatus } from "../src/generated/prisma/enums";
import { addDays, datesOfMonth, fromISODate, istInstant, monthOf, shiftMonth, todayIST, type ISODate } from "../src/lib/dates";
import { calendarDay, monthTotals, resolveDay, weeklyOffFor, type AttendanceRules, type ResolvedDay } from "../src/modules/attendance/rules";

const RULES: AttendanceRules = { officeStart: "09:00", graceMinutes: 15, halfDayMinutes: 240, weeklyOff: [0, 6] };

/** Demo list for 2026 — festival dates must be checked against the government order before real use. */
const HOLIDAYS_2026: [ISODate, string, string, "GAZETTED" | "RESTRICTED"][] = [
  ["2026-01-26", "Republic Day", "गणतंत्र दिवस", "GAZETTED"],
  ["2026-03-04", "Holi", "होली", "GAZETTED"],
  ["2026-03-21", "Id-ul-Fitr", "ईद-उल-फ़ितर", "GAZETTED"],
  ["2026-03-26", "Ram Navami", "राम नवमी", "GAZETTED"],
  ["2026-03-31", "Mahavir Jayanti", "महावीर जयंती", "GAZETTED"],
  ["2026-04-03", "Good Friday", "गुड फ़्राइडे", "GAZETTED"],
  ["2026-05-01", "Buddha Purnima", "बुद्ध पूर्णिमा", "GAZETTED"],
  ["2026-05-27", "Id-ul-Zuha (Bakrid)", "ईद-उल-ज़ुहा (बकरीद)", "GAZETTED"],
  ["2026-06-26", "Muharram", "मुहर्रम", "GAZETTED"],
  ["2026-08-15", "Independence Day", "स्वतंत्रता दिवस", "GAZETTED"],
  ["2026-08-26", "Milad-un-Nabi", "मिलाद-उन-नबी", "GAZETTED"],
  ["2026-09-04", "Janmashtami", "जन्माष्टमी", "GAZETTED"],
  ["2026-10-02", "Mahatma Gandhi's Birthday", "महात्मा गांधी जयंती", "GAZETTED"],
  ["2026-10-20", "Dussehra", "दशहरा", "GAZETTED"],
  ["2026-11-08", "Diwali", "दीपावली", "GAZETTED"],
  ["2026-11-24", "Guru Nanak's Birthday", "गुरु नानक जयंती", "GAZETTED"],
  ["2026-12-25", "Christmas Day", "क्रिसमस", "GAZETTED"],
  ["2026-01-01", "New Year's Day", "नव वर्ष", "RESTRICTED"],
  ["2026-01-14", "Makar Sankranti", "मकर संक्रांति", "RESTRICTED"],
  ["2026-02-15", "Maha Shivratri", "महाशिवरात्रि", "RESTRICTED"],
  ["2026-08-28", "Raksha Bandhan", "रक्षा बंधन", "RESTRICTED"],
  ["2026-09-14", "Ganesh Chaturthi", "गणेश चतुर्थी", "RESTRICTED"],
  ["2026-10-29", "Karva Chauth", "करवा चौथ", "RESTRICTED"],
  ["2026-11-11", "Bhai Duj", "भाई दूज", "RESTRICTED"],
  ["2026-11-15", "Chhath Puja", "छठ पूजा", "RESTRICTED"],
];

/** Health, water, hospital and gardens work six days a week; gardens have no device. */
const SECTION_RULES: Record<string, { mode?: "DEVICE" | "MANUAL"; weeklyOff?: string }> = {
  HLT: { weeklyOff: "0" },
  WTR: { weeklyOff: "0" },
  HSP: { weeklyOff: "0" },
  HRT: { mode: "MANUAL", weeklyOff: "0" },
};

export const DEMO_DEVICE = { serial: "CQZ7224460183", name: "Main office gate" };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 1000;
}

const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

type Kind = "present" | "absent" | "missed" | "half";

/** Punch times for one person-day. */
function punchesFor(date: ISODate, kind: Kind, h: number): Date[] {
  const inAt = 8 * 60 + 45 + (h % 33); // 08:45 – 09:17
  const outAt = 17 * 60 + 35 + ((h >> 2) % 50); // 17:35 – 18:24
  if (kind === "absent") return [];
  if (kind === "missed") return [istInstant(date, hhmm(inAt))];
  if (kind === "half") return [istInstant(date, hhmm(inAt)), istInstant(date, "12:20")];
  return [istInstant(date, hhmm(inAt)), istInstant(date, hhmm(outAt))];
}

interface SeedEmployee {
  id: string;
  code: string;
  sectionCode: string;
  sectionId: string;
  doj: ISODate;
}

/** `users`: Employee logins by Employee ID; `hr`: the HR user shown as having locked last month. */
export async function seedAttendance(db: PrismaClient, boardId: string, employees: SeedEmployee[], users: Map<string, { id: string; name: string }>, hr: { id: string; name: string }) {
  // Holidays, section rules and the demo device — safe to repeat.
  for (const [date, name, nameHi, kind] of HOLIDAYS_2026) {
    await db.holiday.upsert({ where: { boardId_date_name: { boardId, date: fromISODate(date), name } }, create: { boardId, date: fromISODate(date), name, nameHi, kind }, update: { nameHi, kind } });
  }
  for (const [code, rule] of Object.entries(SECTION_RULES)) {
    await db.section.update({ where: { boardId_code: { boardId, code } }, data: { attendanceMode: rule.mode ?? "DEVICE", weeklyOff: rule.weeklyOff ?? null } });
  }
  await db.setting.upsert({
    where: { boardId_key: { boardId, key: "attendance" } },
    create: { boardId, key: "attendance", value: { ...RULES, devices: [DEMO_DEVICE] } },
    update: {},
  });
  if ((await db.attendancePunch.count({ where: { boardId } })) > 0) return;

  const now = new Date();
  const today = todayIST(now);
  const nowMins = Math.floor(((now.getTime() + 330 * 60_000) % 86_400_000) / 60_000);
  const lastMonth = shiftMonth(monthOf(today), -1);
  const dates = [...datesOfMonth(lastMonth), ...datesOfMonth(monthOf(today)).filter((d) => d <= today)];
  const holidays = new Set((await db.holiday.findMany({ where: { boardId, kind: "GAZETTED" } })).map((h) => h.date.toISOString().slice(0, 10)));
  const sections = await db.section.findMany({ where: { boardId } });
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const working = (e: SeedEmployee, d: ISODate) => {
    const s = sectionById.get(e.sectionId)!;
    const cal = calendarDay(d, holidays, weeklyOffFor(s.weeklyOff, RULES.weeklyOff));
    return d >= e.doj && !cal.holiday && !cal.weeklyOff;
  };
  /** The first working day on or after a day of last month. */
  const firstWorking = (e: SeedEmployee, day: number) => datesOfMonth(lastMonth).find((d) => Number(d.slice(8)) >= day && working(e, d))!;

  const punches: { boardId: string; employeeId: string; at: Date; deviceSerial: string }[] = [];
  const muster: { boardId: string; employeeId: string; date: Date; status: DayStatus; source: "MUSTER" }[] = [];
  const forced = new Map<string, Kind>();
  const byCode = new Map(employees.map((e) => [e.code, e]));
  // Health's last month has days its officer must decide at lock.
  if (byCode.get("DCB10010")) forced.set(`DCB10010|${firstWorking(byCode.get("DCB10010")!, 10)}`, "absent");
  if (byCode.get("DCB10011")) forced.set(`DCB10011|${firstWorking(byCode.get("DCB10011")!, 15)}`, "missed");
  if (byCode.get("DCB10022")) forced.set(`DCB10022|${firstWorking(byCode.get("DCB10022")!, 20)}`, "half");
  // This month: Suresh forgot to punch out three working days ago and asked for a correction.
  const suresh = byCode.get("DCB10010");
  let sureshMissed: ISODate | null = null;
  if (suresh) {
    let d = addDays(today, -1);
    let n = 0;
    while (d >= `${monthOf(today)}-01`) {
      if (working(suresh, d) && ++n === 3) {
        sureshMissed = d;
        break;
      }
      d = addDays(d, -1);
    }
    if (sureshMissed) forced.set(`DCB10010|${sureshMissed}`, "missed");
  }

  for (const e of employees) {
    const s = sectionById.get(e.sectionId)!;
    for (const d of dates) {
      if (!working(e, d)) continue;
      const h = hash(`${e.code}|${d}`);
      if (s.attendanceMode === "MANUAL") {
        // HR has entered the muster up to two days ago.
        if (d <= addDays(today, -2)) muster.push({ boardId, employeeId: e.id, date: fromISODate(d), status: h < 60 ? "LATE" : "PRESENT", source: "MUSTER" });
        continue;
      }
      if (d === today) {
        const inAt = 8 * 60 + 45 + (h % 33);
        if (h >= 100 && nowMins >= inAt) punches.push({ boardId, employeeId: e.id, at: istInstant(d, hhmm(inAt)), deviceSerial: DEMO_DEVICE.serial });
        continue;
      }
      const lockedSection = monthOf(d) === lastMonth && s.code !== "HLT";
      let kind: Kind = forced.get(`${e.code}|${d}`) ?? "present";
      if (!forced.has(`${e.code}|${d}`) && !lockedSection && monthOf(d) === monthOf(today)) kind = h < 12 ? "absent" : h < 24 ? "missed" : h < 32 ? "half" : "present";
      for (const at of punchesFor(d, kind, h)) punches.push({ boardId, employeeId: e.id, at, deviceSerial: DEMO_DEVICE.serial });
    }
  }
  await db.attendancePunch.createMany({ data: punches, skipDuplicates: true });
  await db.attendanceDay.createMany({ data: muster, skipDuplicates: true });

  // An approved on-duty day last month (board exam duty) for the teacher who has a login.
  const pooja = byCode.get("DCB10014");
  const poojaUser = users.get("DCB10014");
  if (pooja && poojaUser) {
    const day = firstWorking(pooja, 12);
    await db.attendancePunch.deleteMany({ where: { employeeId: pooja.id, at: { gte: istInstant(day, "00:00"), lt: istInstant(addDays(day, 1), "00:00") } } });
    await db.attendanceDay.create({ data: { boardId, employeeId: pooja.id, date: fromISODate(day), status: "ON_DUTY", source: "REQUEST", note: "Board examination duty at KV No. 2" } });
    await db.attendanceRequest.create({
      data: { boardId, employeeId: pooja.id, date: fromISODate(day), type: "ON_DUTY", reason: "Board examination duty at KV No. 2", status: "APPROVED", createdById: poojaUser.id, decidedAt: new Date() },
    });
  }

  // Lock last month for every section with staff, except Health.
  for (const s of sections) {
    if (s.code === "HLT") continue;
    const staff = employees.filter((e) => e.sectionId === s.id && e.doj <= `${lastMonth}-31`);
    if (staff.length === 0) continue;
    const weeklyOff = weeklyOffFor(s.weeklyOff, RULES.weeklyOff);
    for (const e of staff) {
      const saved = new Map((await db.attendanceDay.findMany({ where: { employeeId: e.id, date: { gte: fromISODate(`${lastMonth}-01`), lte: fromISODate(datesOfMonth(lastMonth).at(-1)!) } } })).map((d) => [d.date.toISOString().slice(0, 10), d]));
      const own = punches.filter((p) => p.employeeId === e.id);
      const days: ResolvedDay[] = [];
      for (const d of datesOfMonth(lastMonth)) {
        const day = resolveDay({
          date: d,
          today,
          onRollFrom: e.doj,
          onRollTo: null,
          mode: s.attendanceMode,
          calendar: calendarDay(d, holidays, weeklyOff),
          saved: saved.get(d) ? { status: saved.get(d)!.status } : null,
          punches: own.filter((p) => todayIST(p.at) === d).map((p) => p.at),
          rules: RULES,
        });
        days.push(day);
        if (!day.status || saved.has(d)) continue;
        await db.attendanceDay.create({
          data: { boardId, employeeId: e.id, date: fromISODate(d), status: day.status, source: day.from === "punches" ? "DEVICE" : "LOCK", firstIn: day.firstIn, lastOut: day.lastOut, workedMinutes: day.workedMinutes },
        });
      }
      const t = monthTotals(days);
      await db.attendanceMonth.create({
        data: {
          boardId,
          employeeId: e.id,
          sectionId: s.id,
          month: lastMonth,
          daysInMonth: t.daysInMonth,
          daysOnRoll: t.daysOnRoll,
          present: t.present,
          late: t.late,
          halfDays: t.halfDays,
          onDuty: t.onDuty,
          leave: t.leave,
          holidays: t.holidays,
          weeklyOffs: t.weeklyOffs,
          diesNon: t.diesNon,
          payableDays: t.payableDays,
          workedDays: t.workedDays,
        },
      });
    }
    // Locked on the 3rd of this month by HR (demo).
    await db.attendanceLock.create({ data: { boardId, sectionId: s.id, month: lastMonth, lockedById: hr.id, lockedByName: hr.name, lockedAt: istInstant(`${monthOf(today)}-03`, "11:00") } });
  }

  // Suresh's missed-punch request, waiting for Rajesh (Health's reporting officer).
  const sureshUser = users.get("DCB10010");
  if (suresh && sureshUser && sureshMissed) {
    const request = await db.attendanceRequest.create({
      data: { boardId, employeeId: suresh.id, date: fromISODate(sureshMissed), type: "MISSED_PUNCH", outTime: "17:50", reason: "Forgot to punch out; left after the evening round.", createdById: sureshUser.id },
    });
    const task = await db.approvalTask.create({
      data: {
        boardId,
        kind: "attendance.request",
        title: `Missed punch: Suresh Pal · ${sureshMissed.split("-").reverse().join("-")}`,
        titleHi: `छूटा पंच: सुरेश पाल · ${sureshMissed.split("-").reverse().join("-")}`,
        details: {
          rows: [
            { label: "Request", labelHi: "अनुरोध", new: "Missed punch" },
            { label: "Out time", labelHi: "जाने का समय", new: "17:50" },
            { label: "Reason", labelHi: "कारण", new: request.reason },
          ],
          link: `/my/team/attendance?month=${monthOf(sureshMissed)}`,
        },
        payload: { requestId: request.id },
        requiredPermission: "REPORTING_OFFICER",
        sectionId: suresh.sectionId,
        subjectEmployeeId: suresh.id,
        entityType: "AttendanceRequest",
        entityId: request.id,
        makerId: sureshUser.id,
        makerName: sureshUser.name,
        makerNote: request.reason,
      },
    });
    await db.attendanceRequest.update({ where: { id: request.id }, data: { taskId: task.id } });
  }
}
