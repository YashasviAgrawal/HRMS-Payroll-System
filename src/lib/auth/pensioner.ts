import "server-only";
import { db } from "@/lib/db";
import { addDays, todayIST, toISODate, type ISODate } from "@/lib/dates";

/** A pension that has stopped (a child's family pension ending) can still be looked at for a year. */
const VIEW_AFTER_END_DAYS = 365;

/**
 * PN-12: the pension an Employee login belongs to — a family pensioner's own login, or the pension the employee earned.
 * `from` is the day the pensioner view starts (the day after retirement).
 */
export async function pensionOfUser(user: { pensionerId: string | null; employeeId: string | null }): Promise<{ id: string; from: ISODate } | null> {
  const where = user.pensionerId ? { id: user.pensionerId } : user.employeeId ? { employeeId: user.employeeId, relation: "SELF" } : null;
  if (!where) return null;
  const p = await db.pensioner.findFirst({ where, orderBy: { startDate: "desc" }, select: { id: true, startDate: true, endDate: true } });
  if (!p) return null;
  if (p.endDate && addDays(toISODate(p.endDate), VIEW_AFTER_END_DAYS) < todayIST()) return null;
  return { id: p.id, from: toISODate(p.startDate) };
}
