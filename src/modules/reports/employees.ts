import "server-only";
import { db } from "@/lib/db";
import { addDays, fromISODate } from "@/lib/dates";
import { d, employeeSelect, monthBounds, nameOf, onRollsWhere, sectionNames, sectionOf } from "./common";
import type { ReportDef, Row } from "./types";

/** Reports 1–6 (PRD §11, Employees): who is on the rolls, where, against which sanction, who leaves, what is missing. */
const TYPES = ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION", "CONTRACT", "DAILY_WAGE", "REEMPLOYED"] as const;

const person = (e: { id: string; employeeCode: string | null; firstName: string; middleName: string | null; lastName: string | null; nameHi: string | null; post: { name: string; nameHi: string }; section: { name: string; nameHi: string } }) => ({
  code: e.employeeCode,
  name: nameOf(e),
  nameHi: e.nameHi ?? nameOf(e),
  post: e.post.name,
  postHi: e.post.nameHi,
  section: e.section.name,
  sectionHi: e.section.nameHi,
  _href: `/employees/${e.id}`,
});

export const EMPLOYEE_REPORTS: ReportDef[] = [
  {
    no: 1,
    key: "employee-list",
    area: "employees",
    fn: "employee_master",
    filters: ["month", "section", "type"],
    async run(actor, f) {
      const rows = await db.employee.findMany({ where: onRollsWhere(actor.boardId, f), select: employeeSelect, orderBy: { employeeCode: "asc" } });
      return {
        columns: [
          { key: "code", t: "reports.cols.code" },
          { key: "name", t: "reports.cols.name" },
          { key: "post", t: "reports.cols.post" },
          { key: "section", t: "reports.cols.section" },
          { key: "type", t: "reports.cols.type", enumKey: "employees.type" },
          { key: "level", t: "reports.cols.levelCell" },
          { key: "doj", t: "reports.cols.doj", kind: "date" },
          { key: "dor", t: "reports.cols.dor", kind: "date" },
          { key: "mobile", t: "reports.cols.mobile" },
          { key: "status", t: "reports.cols.status", enumKey: "employees.status" },
        ],
        rows: rows.map((e) => ({ ...person(e), type: e.type, level: e.payLevel ? `${e.payLevel} / ${e.payCell ?? "—"}` : null, doj: d(e.dateOfJoining), dor: d(e.dateOfRetirement), mobile: e.mobile, status: e.status })),
      };
    },
  },
  {
    no: 2,
    key: "headcount",
    area: "employees",
    fn: "employee_master",
    filters: ["month", "section"],
    async run(actor, f) {
      const rows = await db.employee.findMany({ where: onRollsWhere(actor.boardId, { ...f, type: null }), select: { sectionId: true, type: true, section: { select: { name: true, nameHi: true } } } });
      const by = new Map<string, Row>();
      for (const e of rows) {
        const r = by.get(e.sectionId) ?? ({ section: e.section.name, sectionHi: e.section.nameHi, total: 0, ...Object.fromEntries(TYPES.map((t) => [t, 0])) } as Row);
        r[e.type] = (r[e.type] as number) + 1;
        r.total = (r.total as number) + 1;
        by.set(e.sectionId, r);
      }
      return {
        columns: [{ key: "section", t: "reports.cols.section" }, ...TYPES.map((t) => ({ key: t, t: `employees.type.${t}`, kind: "number" as const, total: true })), { key: "total", t: "reports.cols.total", kind: "number", total: true }],
        rows: [...by.values()].sort((a, b) => String(a.section).localeCompare(String(b.section))),
      };
    },
  },
  {
    no: 3,
    key: "sanctioned-filled",
    area: "employees",
    fn: "employee_master",
    filters: ["month", "section"],
    async run(actor, f) {
      const section = sectionOf(f);
      const [sanctioned, staff, sections, posts] = await Promise.all([
        db.sanctionedPost.findMany({ where: { boardId: actor.boardId, ...(section ? { sectionId: section } : {}) } }),
        db.employee.findMany({ where: { ...onRollsWhere(actor.boardId, { ...f, type: null }), type: { in: ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION"] } }, select: { sectionId: true, postId: true, section: { select: { name: true, nameHi: true } }, post: { select: { name: true, nameHi: true } } } }),
        sectionNames(actor.boardId),
        db.post.findMany({ where: { boardId: actor.boardId }, select: { id: true, name: true, nameHi: true } }),
      ]);
      const pBy = new Map(posts.map((p) => [p.id, p]));
      const by = new Map<string, Row>();
      for (const s of sanctioned) {
        const sec = sections.get(s.sectionId);
        const post = pBy.get(s.postId);
        by.set(`${s.sectionId}|${s.postId}`, { section: sec?.name ?? "", sectionHi: sec?.nameHi ?? "", post: post?.name ?? "", postHi: post?.nameHi ?? "", sanctioned: s.sanctioned, filled: 0, vacant: s.sanctioned });
      }
      for (const e of staff) {
        const k = `${e.sectionId}|${e.postId}`;
        const r = by.get(k) ?? { section: e.section.name, sectionHi: e.section.nameHi, post: e.post.name, postHi: e.post.nameHi, sanctioned: 0, filled: 0, vacant: 0 };
        r.filled = (r.filled as number) + 1;
        r.vacant = (r.sanctioned as number) - (r.filled as number);
        by.set(k, r);
      }
      const rows = [...by.values()].map((r): Row => ({ ...r, _tone: (r.vacant as number) < 0 ? ("red" as const) : (r.vacant as number) > 0 ? ("amber" as const) : null }));
      return {
        columns: [
          { key: "section", t: "reports.cols.section" },
          { key: "post", t: "reports.cols.post" },
          { key: "sanctioned", t: "reports.cols.sanctioned", kind: "number", total: true },
          { key: "filled", t: "reports.cols.filled", kind: "number", total: true },
          { key: "vacant", t: "reports.cols.vacant", kind: "number", total: true },
        ],
        rows: rows.sort((a, b) => String(a.section).localeCompare(String(b.section)) || String(a.post).localeCompare(String(b.post))),
        note: { en: "Permanent and deputation staff against the sanctioned strength. A negative number means more people than posts.", hi: "स्वीकृत पदों के मुकाबले स्थायी और प्रतिनियुक्ति कर्मचारी। ऋणात्मक संख्या का अर्थ है पदों से अधिक लोग।" },
      };
    },
  },
  {
    no: 4,
    key: "retirements-probation",
    area: "employees",
    fn: "employee_master",
    filters: ["month", "section", "type"],
    async run(actor, f) {
      const { from } = monthBounds(f.month);
      const until = addDays(from, 366);
      const section = sectionOf(f);
      const rows = await db.employee.findMany({
        where: {
          boardId: actor.boardId,
          status: { in: ["ACTIVE", "SUSPENDED"] },
          ...(section ? { sectionId: section } : {}),
          ...(f.type ? { type: f.type } : {}),
          OR: [{ dateOfRetirement: { gte: fromISODate(from), lte: fromISODate(until) } }, { confirmationDate: null, probationEndDate: { not: null, lte: fromISODate(addDays(from, 92)) } }],
        },
        select: employeeSelect,
        orderBy: { employeeCode: "asc" },
      });
      const out: Row[] = [];
      for (const e of rows) {
        const dor = d(e.dateOfRetirement);
        if (dor && dor >= from && dor <= until) out.push({ ...person(e), what: "RETIREMENT", date: dor });
        const prob = d(e.probationEndDate);
        if (prob && !e.confirmationDate && prob <= addDays(from, 92)) out.push({ ...person(e), what: "PROBATION", date: prob, _tone: prob < from ? "red" : null });
      }
      return {
        columns: [
          { key: "code", t: "reports.cols.code" },
          { key: "name", t: "reports.cols.name" },
          { key: "post", t: "reports.cols.post" },
          { key: "section", t: "reports.cols.section" },
          { key: "what", t: "reports.cols.due", enumKey: "reports.dueKinds" },
          { key: "date", t: "reports.cols.date", kind: "date" },
        ],
        rows: out.sort((a, b) => String(a.date).localeCompare(String(b.date))),
        note: { en: "Retirements in the 12 months from the chosen month; probations ending within 3 months (red: already over, not confirmed).", hi: "चुने माह से 12 माह में सेवानिवृत्ति; 3 माह में समाप्त होने वाली परिवीक्षा (लाल: समाप्त, पुष्टि नहीं)।" },
      };
    },
  },
  {
    no: 5,
    key: "missing-ids",
    area: "employees",
    fn: "employee_master",
    filters: ["month", "section", "type"],
    async run(actor, f) {
      const rows = await db.employee.findMany({ where: { ...onRollsWhere(actor.boardId, f), status: { in: ["ACTIVE", "SUSPENDED"] } }, select: employeeSelect, orderBy: { employeeCode: "asc" } });
      const yes = (b: boolean) => (b ? "MISSING" : "OK");
      const out: Row[] = [];
      for (const e of rows) {
        const needsPran = e.type === "PERMANENT_NPS";
        const needsUan = e.type === "CONTRACT" || e.type === "DAILY_WAGE";
        const missing = { pan: !e.panHash, aadhaar: !e.aadhaarHash, bank: !e.bankAccountHash || !e.ifsc, pran: needsPran && !e.pran, uan: needsUan && !e.uan, gpf: e.type === "PERMANENT_OPS" && !e.gpfNumber };
        if (!Object.values(missing).some(Boolean)) continue;
        out.push({ ...person(e), type: e.type, pan: yes(missing.pan), aadhaar: yes(missing.aadhaar), bank: yes(missing.bank), pran: needsPran ? yes(missing.pran) : null, uan: needsUan ? yes(missing.uan) : null, gpf: e.type === "PERMANENT_OPS" ? yes(missing.gpf) : null });
      }
      return {
        columns: [
          { key: "code", t: "reports.cols.code" },
          { key: "name", t: "reports.cols.name" },
          { key: "section", t: "reports.cols.section" },
          { key: "type", t: "reports.cols.type", enumKey: "employees.type" },
          { key: "pan", t: "reports.cols.pan", enumKey: "reports.okMissing" },
          { key: "aadhaar", t: "reports.cols.aadhaar", enumKey: "reports.okMissing" },
          { key: "bank", t: "reports.cols.bank", enumKey: "reports.okMissing" },
          { key: "pran", t: "reports.cols.pran", enumKey: "reports.okMissing" },
          { key: "uan", t: "reports.cols.uan", enumKey: "reports.okMissing" },
          { key: "gpf", t: "reports.cols.gpfNo", enumKey: "reports.okMissing" },
        ],
        rows: out,
        note: { en: "Only people with something missing are listed. PRAN is needed for NPS staff, UAN for contract and daily-wage workers, a GPF number for OPS staff.", hi: "केवल जिनका कुछ अधूरा है वे दिखाए गए हैं। एनपीएस कर्मचारियों के लिए पीआरएएन, संविदा और दैनिक वेतन के लिए यूएएन, ओपीएस के लिए जीपीएफ संख्या आवश्यक।" },
      };
    },
  },
  {
    no: 6,
    key: "recruitment",
    area: "employees",
    fn: "recruitment",
    filters: ["section"],
    async run(actor, f) {
      const section = sectionOf(f);
      const vacancies = await db.vacancy.findMany({
        where: { boardId: actor.boardId, ...(section ? { sectionId: section } : {}), status: { notIn: ["CANCELLED", "REJECTED"] } },
        include: { applicants: { select: { status: true } }, joinings: { select: { status: true } } },
        orderBy: { createdAt: "desc" },
      });
      const [sBy, posts] = await Promise.all([sectionNames(actor.boardId), db.post.findMany({ where: { boardId: actor.boardId }, select: { id: true, name: true, nameHi: true } })]);
      const pBy = new Map(posts.map((p) => [p.id, p]));
      return {
        columns: [
          { key: "ref", t: "reports.cols.vacancy" },
          { key: "post", t: "reports.cols.post" },
          { key: "section", t: "reports.cols.section" },
          { key: "seats", t: "reports.cols.seats", kind: "number", total: true },
          { key: "status", t: "reports.cols.status", enumKey: "recruitment.vstatus" },
          { key: "applied", t: "reports.cols.applied", kind: "number", total: true },
          { key: "shortlisted", t: "reports.cols.shortlisted", kind: "number", total: true },
          { key: "selected", t: "reports.cols.selected", kind: "number", total: true },
          { key: "joined", t: "reports.cols.joined", kind: "number", total: true },
        ],
        rows: vacancies.map((v) => ({
          ref: v.referenceNo,
          post: pBy.get(v.postId)?.name ?? "",
          postHi: pBy.get(v.postId)?.nameHi ?? "",
          section: sBy.get(v.sectionId)?.name ?? "",
          sectionHi: sBy.get(v.sectionId)?.nameHi ?? "",
          seats: v.seats,
          status: v.status,
          applied: v.applicants.length,
          shortlisted: v.applicants.filter((a) => ["SHORTLISTED", "SELECTED", "WAITLISTED"].includes(a.status)).length,
          selected: v.applicants.filter((a) => a.status === "SELECTED").length,
          joined: v.joinings.filter((j) => j.status === "COMPLETED").length,
          _href: `/recruitment/vacancies/${v.id}`,
        })),
      };
    },
  },
];
