/**
 * Payroll (Module 6): the rules every installation starts with — the 7th CPC pay matrix, the dated rates and the pay
 * heads — and, for the demo, standing pay items and two closed months of payroll worked out by the real engine.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import { datesOfMonth, fromISODate, shiftMonth, todayIST, weekday } from "../src/lib/dates";
import { computeRun, RUN_GROUPS, saveRun } from "../src/modules/payroll/compute";
import { PAY_HEAD_DEFAULTS } from "../src/modules/payroll/head-defaults";
import { seventhCpcMatrix } from "../src/modules/payroll/matrix-7cpc";
import { RATE_DEFAULTS } from "../src/modules/payroll/rate-catalog";

/** Matrix, rates and pay heads. Existing rows are left alone: after the first load the tables belong to the Board. */
export async function seedPayrollRules(db: PrismaClient, boardId: string) {
  await db.payMatrix.upsert({
    where: { boardId_effectiveFrom: { boardId, effectiveFrom: fromISODate("2016-01-01") } },
    create: { boardId, name: "7th CPC pay matrix", effectiveFrom: fromISODate("2016-01-01"), levels: seventhCpcMatrix() },
    update: {},
  });
  for (const [key, value, from] of RATE_DEFAULTS) {
    await db.payRate.upsert({
      where: { boardId_key_effectiveFrom: { boardId, key, effectiveFrom: fromISODate(from) } },
      create: { boardId, key, value, effectiveFrom: fromISODate(from), note: "Default rate" },
      update: {},
    });
  }
  for (const [i, h] of PAY_HEAD_DEFAULTS.entries()) {
    await db.payHead.upsert({
      where: { boardId_code: { boardId, code: h.code } },
      create: {
        boardId,
        code: h.code,
        name: h.name,
        nameHi: h.nameHi,
        kind: h.kind,
        calc: h.calc,
        value: h.value ?? 0,
        postCodes: h.postCodes ?? [],
        prorate: h.prorate ?? true,
        countsForDa: h.countsForDa ?? false,
        taxable: h.taxable ?? true,
        accountHead: h.accountHead,
        sortOrder: i + 1,
      },
      update: {},
    });
  }
}

/** [employee code, head, amount, from month offset (0 = two months ago), to month offset or null, note] */
const DEMO_ITEMS: [string, string, number, number, number | null, string][] = [
  ["DCB10002", "GPF", 15000, 0, null, "GPF subscription as chosen"],
  ["DCB10008", "GPF", 8000, 0, null, "GPF subscription as chosen"],
  ["DCB10025", "GPF", 10000, 0, null, "GPF subscription as chosen"],
  ["DCB10009", "LICENCE", 650, 0, null, "Type-I quarter, Sadar Bazar"],
  ["DCB10010", "LICENCE", 520, 0, null, "Type-I quarter, Gopinath Bazar"],
  ["DCB10001", "IT", 15000, 0, null, "TDS projected for 2026-27"],
  ["DCB10002", "IT", 9500, 0, null, "TDS projected for 2026-27"],
  ["DCB10017", "IT", 12000, 0, null, "TDS projected for 2026-27"],
  ["DCB10013", "IT", 4200, 0, null, "TDS projected for 2026-27"],
  ["DCB10005", "SOCIETY", 1000, 0, null, "DCB Employees' Co-operative Society"],
  ["DCB10012", "LOAN", 3000, 0, null, "Festival advance — instalment"],
  ["DCB10016", "IT", 6000, 2, null, "TDS revised after declarations"],
  // A one-off recovery this month makes a net-pay change over 25% for the Checker to see (PR-10).
  ["DCB10019", "RECOVERY", 18000, 2, 2, "Recovery of HRA paid twice in August"],
];

/**
 * Demo: standing pay items, and the last two months of payroll for every pay group, closed — so this month shows the
 * change against last month, and the run for this month is left for the user to do.
 */
export async function seedPayrollDemo(db: PrismaClient, boardId: string, people: Map<string, string>, users: { payroll: { id: string; name: string }; checker: { id: string; name: string }; signer: { id: string; name: string } }) {
  if ((await db.payrollRun.count({ where: { boardId } })) > 0) return;
  const thisMonth = todayIST().slice(0, 7);
  const months = [shiftMonth(thisMonth, -2), shiftMonth(thisMonth, -1)];
  for (const [code, headCode, amount, from, to, note] of DEMO_ITEMS) {
    const employeeId = people.get(code);
    if (!employeeId) continue;
    await db.employeePayItem.create({
      data: { boardId, employeeId, headCode, amount, fromMonth: shiftMonth(months[0], from), toMonth: to === null ? null : shiftMonth(months[0], to), note, createdById: users.payroll.id },
    });
  }
  for (const [mi, month] of months.entries()) {
    for (const group of RUN_GROUPS) {
      // Demo history ignores attendance: the seeded punches only cover last month and this month.
      const workedDays = datesOfMonth(shiftMonth(month, -1)).filter((d) => weekday(d) !== 0).length;
      const computed = await computeRun(db, boardId, group, month, { ignoreAttendance: true, assumeWorkedDays: workedDays });
      if (!computed.slips.length) continue;
      await db.$transaction(async (tx) => {
        const run = await saveRun(tx, { boardId, userId: users.payroll.id, name: users.payroll.name }, group, month, computed);
        await tx.payrollException.updateMany({ where: { runId: run.id }, data: { resolution: "EXPLAINED", note: "Checked (demo history)", resolvedById: users.payroll.id, resolvedByName: users.payroll.name, resolvedAt: new Date() } });
        const day = (d: number) => fromISODate(`${shiftMonth(month, 1)}-0${d}`);
        const payDay = new Date(`${month}-${mi === 0 ? 28 : 27}T06:30:00Z`);
        await tx.payrollRun.update({
          where: { id: run.id },
          data: {
            status: "CLOSED",
            runAt: new Date(`${month}-24T05:30:00Z`),
            submittedAt: new Date(`${month}-24T09:00:00Z`),
            checkedById: users.checker.id,
            checkedByName: users.checker.name,
            approvedById: users.signer.id,
            approvedByName: users.signer.name,
            approvedAt: new Date(`${month}-26T07:00:00Z`),
            paidAt: payDay,
            returnAt: day(2),
            closedAt: day(3),
          },
        });
        await tx.payslip.updateMany({ where: { runId: run.id, status: "INCLUDED" }, data: { creditStatus: "CREDITED" } });
      });
    }
  }
}
