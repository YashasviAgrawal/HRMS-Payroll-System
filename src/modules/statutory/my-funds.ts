import "server-only";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { todayIST } from "@/lib/dates";
import { forbidden } from "@/lib/errors";
import type { PayLine } from "@/modules/payroll/engine";
import { gpfAccount } from "./gpf";
import { fyMonths, fyOfMonth } from "./tax-rules";

const PAID = ["APPROVED", "PAID", "CLOSED"] as const;

/** S-50 for the employee: their GPF account (OPS staff) or their NPS contributions from the pay bills (NPS staff). */
export async function myFunds(actor: Actor, fy?: string) {
  if (!actor.employeeId) throw forbidden();
  const e = await db.employee.findUniqueOrThrow({ where: { id: actor.employeeId }, select: { id: true, type: true, pran: true, _count: { select: { gpfEntries: true } } } });
  const gpf = e._count.gpfEntries > 0 || e.type === "PERMANENT_OPS" ? await gpfAccount(actor, e.id, fy) : null;
  let nps: { pran: string | null; fy: string; months: { month: string; own: number; board: number }[]; yearOwn: number; yearBoard: number; totalOwn: number; totalBoard: number } | null = null;
  if (e.type === "PERMANENT_NPS") {
    const year = fy && /^\d{4}-\d{2}$/.test(fy) ? fy : fyOfMonth(todayIST().slice(0, 7));
    const [from, to] = fyMonths(year);
    const slips = await db.payslip.findMany({ where: { employeeId: e.id, status: "INCLUDED", run: { status: { in: [...PAID] } } }, select: { month: true, lines: true }, orderBy: { month: "asc" } });
    const byMonth = new Map<string, { own: number; board: number }>();
    let totalOwn = 0;
    let totalBoard = 0;
    for (const s of slips) {
      const lines = s.lines as unknown as PayLine[];
      const own = lines.filter((l) => l.code === "NPS").reduce((a, l) => a + l.amount, 0);
      const board = lines.filter((l) => l.code === "NPS_ER").reduce((a, l) => a + l.amount, 0);
      totalOwn += own;
      totalBoard += board;
      if (s.month < from || s.month > to) continue;
      const m = byMonth.get(s.month) ?? { own: 0, board: 0 };
      byMonth.set(s.month, { own: m.own + own, board: m.board + board });
    }
    const months = [...byMonth].map(([month, v]) => ({ month, ...v }));
    nps = { pran: e.pran, fy: year, months, yearOwn: months.reduce((a, m) => a + m.own, 0), yearBoard: months.reduce((a, m) => a + m.board, 0), totalOwn, totalBoard };
  }
  return { gpf, nps };
}
