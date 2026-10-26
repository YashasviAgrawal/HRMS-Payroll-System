import "server-only";
import { audit } from "@/lib/audit";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { sendSms } from "@/lib/connectors/sms";
import { db } from "@/lib/db";
import { addDays, formatDate, fromISODate, todayIST, toISODate, type ISODate } from "@/lib/dates";
import { forbidden } from "@/lib/errors";
import { DUE_DEFAULTS, dueItems, type DueItem, type DueKind, type DueRuleDef } from "./calendar";

/**
 * ST-08: the statutory calendar — every due date from the editable rules, each marked done when the record that
 * satisfies it exists (a challan, a released file, Form 16 published) — on the Statutory screen and in "My work",
 * with an SMS to the people who prepare the filings 5 days before each date that is not yet done.
 */
const canSee = (actor: Actor) => canAll(actor, "statutory", "view");
const REMIND_DAYS = 5;
const RELEASED = ["APPROVED", "DOWNLOADED"] as const;
/** The pay head whose deduction makes a monthly filing due. */
const HEAD_OF: Record<string, string> = { NPS_CRA: "NPS", EPF_ECR: "EPF", ESIC: "ESIC", PENSION_FUND: "PENSION_ER" };
const FILE_KIND: Record<string, string> = { NPS_CRA: "stat.nps", EPF_ECR: "stat.ecr", ESIC: "stat.esic", PENSION_FUND: "stat.pension", FORM_24Q: "tds.24q" };

export type DueState = "DONE" | "OPEN" | "OVERDUE" | "NOTHING";

export interface CalendarItem extends DueItem {
  state: DueState;
  /** Where to do it. */
  href: string;
  daysLeft: number;
}

export async function dueRules(boardId: string): Promise<DueRuleDef[]> {
  const rows = await db.dueRule.findMany({ where: { boardId }, orderBy: { code: "asc" } });
  if (!rows.length) return DUE_DEFAULTS;
  return rows.map((r) => ({ code: r.code, name: r.name, nameHi: r.nameHi, kind: r.kind as DueKind, day: r.day, dates: r.dates }));
}

const HREF: Record<string, (i: DueItem) => string> = {
  TDS_DEPOSIT: (i) => `/statutory/tds?fy=${fyOfMonthLocal(i.period)}`,
  NPS_CRA: (i) => `/statutory/files?month=${i.period}`,
  EPF_ECR: (i) => `/statutory/files?month=${i.period}`,
  ESIC: (i) => `/statutory/files?month=${i.period}`,
  PENSION_FUND: (i) => `/statutory/files?month=${i.period}`,
  FORM_24Q: (i) => `/statutory/tds?fy=${i.period.slice(0, 7)}`,
  FORM_16: (i) => `/statutory/form16?fy=${i.period}`,
  TAX_PROOFS: () => `/statutory/declarations`,
};

function fyOfMonthLocal(month: string) {
  const y = Number(month.slice(0, 4));
  const s = Number(month.slice(5, 7)) >= 4 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
}

const daysBetween = (a: ISODate, b: ISODate) => Math.round((fromISODate(b).getTime() - fromISODate(a).getTime()) / 86_400_000);

/** Due dates from `from` to `to`, each with whether it is done. */
export async function calendarFor(boardId: string, from: ISODate, to: ISODate, today: ISODate = todayIST()): Promise<CalendarItem[]> {
  const rules = await dueRules(boardId);
  // AFTER_PAY rules count from the day each regular OPS bill was approved.
  const opsRuns = await db.payrollRun.findMany({ where: { boardId, payGroup: "OPS", kind: "REGULAR", approvedAt: { not: null } }, select: { month: true, approvedAt: true } });
  const approvals = new Map(opsRuns.map((r) => [r.month, toISODate(r.approvedAt!)]));
  const items = dueItems(rules, from, to, approvals);
  const periods = [...new Set(items.map((i) => i.period))];
  const [files, challans, slips, forms, waitingDecl] = await Promise.all([
    db.fileRecord.findMany({ where: { boardId, kind: { in: Object.values(FILE_KIND) }, period: { in: periods }, status: { in: [...RELEASED] } }, select: { kind: true, period: true } }),
    db.tdsChallan.groupBy({ by: ["month"], where: { boardId, month: { in: periods } }, _sum: { tax: true, cess: true, interest: true } }),
    db.payslip.findMany({ where: { boardId, month: { in: periods }, status: "INCLUDED", run: { status: { in: ["APPROVED", "PAID", "CLOSED"] } } }, select: { month: true, payGroup: true, lines: true } }),
    db.form16.groupBy({ by: ["fy"], where: { boardId, publishedAt: { not: null } }, _count: { _all: true } }),
    db.approvalTask.count({ where: { boardId, kind: "tax.declaration", status: "PENDING" } }),
  ]);
  const released = new Set(files.map((f) => `${f.kind}|${f.period}`));
  const deposited = new Map(challans.map((c) => [c.month, Number(c._sum.tax ?? 0) + Number(c._sum.cess ?? 0) + Number(c._sum.interest ?? 0)]));
  const tds = new Map<string, number>();
  const groups = new Map<string, Set<string>>();
  // Heads actually deducted in each month's approved bills: no ESIC deducted means no ESIC return is due.
  const heads = new Map<string, Set<string>>();
  for (const s of slips) {
    const lines = s.lines as unknown as { code: string; amount: number }[];
    tds.set(s.month, (tds.get(s.month) ?? 0) + lines.filter((l) => l.code === "IT").reduce((a, l) => a + l.amount, 0));
    groups.set(s.month, (groups.get(s.month) ?? new Set()).add(s.payGroup));
    const h = heads.get(s.month) ?? new Set<string>();
    for (const l of lines) if (l.amount > 0) h.add(l.code);
    heads.set(s.month, h);
  }
  const published = new Set(forms.map((f) => f.fy));
  return items.map((i) => {
    let state: DueState = "OPEN";
    if (i.code === "TDS_DEPOSIT") state = !groups.has(i.period) ? "OPEN" : (tds.get(i.period) ?? 0) === 0 ? "NOTHING" : (deposited.get(i.period) ?? 0) >= (tds.get(i.period) ?? 0) ? "DONE" : "OPEN";
    else if (i.code === "FORM_16") state = published.has(i.period) ? "DONE" : "OPEN";
    else if (i.code === "TAX_PROOFS") state = i.dueOn < today && waitingDecl === 0 ? "DONE" : "OPEN";
    else if (FILE_KIND[i.code]) {
      const head = HEAD_OF[i.code];
      const nothing = Boolean(head) && groups.has(i.period) && !heads.get(i.period)!.has(head!);
      state = released.has(`${FILE_KIND[i.code]}|${i.period}`) ? "DONE" : nothing ? "NOTHING" : "OPEN";
    }
    if (state === "OPEN" && i.dueOn < today) state = "OVERDUE";
    return { ...i, state, href: (HREF[i.code] ?? (() => "/statutory"))(i), daysLeft: daysBetween(today, i.dueOn) };
  });
}

/** S-52 calendar tab: last month's open items and the next three months. */
export async function statutoryCalendar(actor: Actor) {
  if (!canSee(actor)) throw forbidden();
  const today = todayIST();
  const items = await calendarFor(actor.boardId, addDays(today, -45), addDays(today, 92), today);
  return { today, items: items.filter((i) => i.dueOn >= today || i.state === "OVERDUE" || i.state === "DONE") };
}

/** "My work" (ST-08): open filings due within 5 days, and any overdue, for the people who prepare them. */
export async function dueSoon(actor: Actor) {
  if (!canAll(actor, "statutory", "create")) return [];
  const today = todayIST();
  const items = await calendarFor(actor.boardId, addDays(today, -60), addDays(today, REMIND_DAYS), today);
  return items.filter((i) => i.state === "OPEN" || i.state === "OVERDUE");
}

const reminded = new Map<string, string>();

/**
 * ST-08: once a day, an SMS to each HR & Accounts user with the Payroll permission for every open filing due in 5 days
 * (each due date reminded once — DueReminder keeps the record). Runs the first time the home page is opened each day.
 */
export async function sendDueReminders(boardId: string, today: ISODate = todayIST()) {
  if (reminded.get(boardId) === today) return 0;
  reminded.set(boardId, today);
  const target = addDays(today, REMIND_DAYS);
  const items = (await calendarFor(boardId, today, target, today)).filter((i) => i.state === "OPEN" && i.dueOn <= target);
  if (!items.length) return 0;
  const done = await db.dueReminder.findMany({ where: { boardId, dueOn: { gte: fromISODate(today), lte: fromISODate(target) } }, select: { code: true, dueOn: true } });
  const sent = new Set(done.map((d) => `${d.code}|${toISODate(d.dueOn)}`));
  const due = items.filter((i) => !sent.has(`${i.code}|${i.dueOn}`));
  if (!due.length) return 0;
  const users = await db.user.findMany({ where: { boardId, status: "ACTIVE", loginType: "HR_ACCOUNTS", permissions: { has: "PAYROLL" } }, select: { mobile: true, language: true } });
  let count = 0;
  for (const i of due) {
    try {
      await db.dueReminder.create({ data: { boardId, code: i.code, dueOn: fromISODate(i.dueOn) } });
    } catch {
      continue; // another request reminded it at the same moment
    }
    for (const u of users) {
      if (!u.mobile) continue;
      const hi = u.language === "hi";
      const text = hi ? `${i.nameHi} (${i.period}) ${formatDate(i.dueOn, "hi")} तक देय है।` : `${i.name} (${i.period}) is due by ${formatDate(i.dueOn)}.`;
      await sendSms(boardId, u.mobile, "alert", { text }, hi ? "hi" : "en");
    }
    count += 1;
  }
  await audit(db, { boardId, name: "System (statutory calendar)" }, { action: "NOTIFY", entityType: "DueReminder", summary: `Statutory reminders sent for ${count} due dates to ${users.length} people`, category: "SYSTEM" });
  return count;
}

/** For tests: forget that today's reminders were sent. */
export function resetReminderCheck() {
  reminded.clear();
}

