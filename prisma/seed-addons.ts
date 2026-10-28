/**
 * Demo data for the client add-ons, shared by the seed and `npm run db:demo-addons` (which brings an existing demo
 * copy up to date without touching anything already there). Never for production data.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import { addDays, fromISODate, todayIST } from "../src/lib/dates";

const ORDER = "DCB/EST/Resig/41";

/**
 * A resignation at the end of last month (Vikas Malhotra, DCB10012, with a running loan) whose full and final
 * settlement Payroll still has to prepare. Idempotent: made once; on a later run only puts the person back off the
 * rolls if a re-seed reset them. Returns what it did.
 */
export async function seedDemoLeaver(db: PrismaClient, boardId: string): Promise<"added" | "kept" | "skipped"> {
  const e = await db.employee.findFirst({ where: { boardId, employeeCode: "DCB10012" } });
  if (!e) return "skipped";
  const existing = await db.separation.findFirst({ where: { employeeId: e.id, kind: "RESIGNATION", orderNumber: ORDER } });
  if (existing) {
    if (e.status === "ACTIVE") await db.employee.update({ where: { id: e.id }, data: { status: "RESIGNED", exitDate: existing.effectiveDate, exitReason: `Resignation (order ${ORDER})` } });
    return "kept";
  }
  if (e.status !== "ACTIVE" || (await db.separation.count({ where: { employeeId: e.id } }))) return "skipped";
  const hr = await db.user.findFirst({ where: { boardId, loginType: "HR_ACCOUNTS", loginId: "DCB10003" } });
  if (!hr) return "skipped";
  const lastDay = addDays(`${todayIST().slice(0, 7)}-01`, -1);
  const orderDate = addDays(lastDay, -30);
  const sep = await db.separation.create({
    data: { boardId, employeeId: e.id, kind: "RESIGNATION", status: "APPROVED", effectiveDate: fromISODate(lastDay), orderNumber: ORDER, orderDate: fromISODate(orderDate), reason: "Resigned on selection to a post in the Delhi Jal Board; one month's notice served.", createdById: hr.id, createdByName: hr.displayName, approvedAt: new Date(`${orderDate}T10:00:00Z`) },
  });
  await db.employee.update({ where: { id: e.id }, data: { status: "RESIGNED", exitDate: fromISODate(lastDay), exitReason: `Resignation (order ${ORDER})` } });
  await db.serviceBookEntry.create({
    data: { employeeId: e.id, event: "EXIT", eventDate: fromISODate(lastDay), orderNumber: ORDER, orderDate: fromISODate(orderDate), details: `Resignation accepted; last day of service ${lastDay}.`, detailsHi: `त्यागपत्र स्वीकृत; सेवा का अंतिम दिन ${lastDay}।`, data: { separationId: sep.id, kind: "RESIGNATION" }, status: "APPROVED", createdById: hr.id },
  });
  return "added";
}
