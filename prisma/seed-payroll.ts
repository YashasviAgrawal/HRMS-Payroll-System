/**
 * Payroll (Module 6): the rules every installation starts with — the 7th CPC pay matrix, the dated rates and the pay
 * heads — and, for the demo, standing pay items and two closed months of payroll worked out by the real engine.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import { datesOfMonth, fromISODate, shiftMonth, todayIST, weekday } from "../src/lib/dates";
import { computeRun, recordLoanRecoveries, RUN_GROUPS, saveRun } from "../src/modules/payroll/compute";
import { PAY_HEAD_DEFAULTS } from "../src/modules/payroll/head-defaults";
import { seventhCpcMatrix } from "../src/modules/payroll/matrix-7cpc";
import { incrementDatesAround, incrementMonthFor } from "../src/modules/payroll/pay-rules";
import { RATE_DEFAULTS } from "../src/modules/payroll/rate-catalog";
import { recordGpf } from "../src/modules/statutory/gpf-posting";
import { seedGpfOpenings, seedStatutoryBeforePayroll } from "./seed-statutory";

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
  ["DCB10005", "SOCIETY", 1000, 0, null, "DCB Employees' Co-operative Society"],
  // A one-off recovery this month makes a net-pay change over 25% for the Checker to see (PR-10).
  ["DCB10019", "RECOVERY", 18000, 2, 2, "Recovery of HRA paid twice in August"],
];

/**
 * Demo: standing pay items, and the last two months of payroll for every pay group, closed — so this month shows the
 * change against last month, and the run for this month is left for the user to do.
 */
export async function seedPayrollDemo(db: PrismaClient, boardId: string, people: Map<string, string>, users: { payroll: { id: string; name: string }; checker: { id: string; name: string }; signer: { id: string; name: string } }) {
  if ((await db.payrollRun.count({ where: { boardId } })) > 0) return;
  const today = todayIST();
  const thisMonth = today.slice(0, 7);
  const months = [shiftMonth(thisMonth, -2), shiftMonth(thisMonth, -1)];

  // PR-06: the last 1 January and 1 July increments were given on time — pay history and service book.
  const { last } = incrementDatesAround(today);
  const lastJan = `${last.slice(0, 4)}-01-01`;
  const staff = await db.employee.findMany({ where: { boardId, status: "ACTIVE", type: { in: ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION"] }, payCell: { gt: 1 } } });
  for (const e of staff) {
    const doj = e.dateOfJoining.toISOString().slice(0, 10);
    const due = incrementMonthFor(doj) === 1 ? lastJan : `${last.slice(0, 4)}-07-01`;
    if (due > today || doj > `${shiftMonth(due.slice(0, 7), -6)}-01`) continue;
    const entry = await db.serviceBookEntry.create({
      data: { employeeId: e.id, event: "INCREMENT", eventDate: fromISODate(due), details: `Annual increment: Level ${e.payLevel}, cell ${e.payCell! - 1} → ${e.payCell}`, detailsHi: `वार्षिक वेतन वृद्धि: लेवल ${e.payLevel}, सेल ${e.payCell! - 1} → ${e.payCell}`, data: { fromLevel: e.payLevel, fromCell: e.payCell! - 1, toLevel: e.payLevel, toCell: e.payCell }, status: "APPROVED", createdById: users.payroll.id, approvedById: users.checker.id },
    });
    await db.payHistory.create({ data: { boardId, employeeId: e.id, effectiveFrom: fromISODate(due), payLevel: e.payLevel!, payCell: e.payCell!, reason: "INCREMENT", serviceEntryId: entry.id, applied: true, createdById: users.payroll.id } });
  }

  // PR-09: two running loans, recovered through the closed months below.
  const loan = async (code: string, data: { type: "FESTIVAL" | "COMPUTER"; principal: number; interestRate: number; instalments: number; purpose: string; order: string }) => {
    const employeeId = people.get(code);
    if (!employeeId) return;
    await db.loan.create({
      data: { boardId, employeeId, type: data.type, purpose: data.purpose, principal: data.principal, interestRate: data.interestRate, instalments: data.instalments, instalmentAmount: Math.ceil(data.principal / data.instalments), sanctionDate: fromISODate(`${shiftMonth(months[0], -1)}-20`), orderNumber: data.order, startMonth: months[0], status: "RUNNING", createdById: users.payroll.id, createdByName: users.payroll.name },
    });
  };
  await loan("DCB10012", { type: "FESTIVAL", principal: 10000, interestRate: 0, instalments: 10, purpose: "Festival advance", order: "DCB/Accts/Adv/112" });
  await loan("DCB10013", { type: "COMPUTER", principal: 50000, interestRate: 9.8, instalments: 25, purpose: "Laptop for site inspections", order: "DCB/Accts/Adv/108" });
  for (const [code, headCode, amount, from, to, note] of DEMO_ITEMS) {
    const employeeId = people.get(code);
    if (!employeeId) continue;
    await db.employeePayItem.create({
      data: { boardId, employeeId, headCode, amount, fromMonth: shiftMonth(months[0], from), toMonth: to === null ? null : shiftMonth(months[0], to), note, createdById: users.payroll.id },
    });
  }
  // Module 8: declarations, salary brought from the old system and a GPF advance — before the history is worked out.
  await seedStatutoryBeforePayroll(db, boardId, people, { payroll: users.payroll, checker: users.checker }, months);
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
        await tx.payslip.updateMany({ where: { runId: run.id, status: "INCLUDED" }, data: { creditStatus: "CREDITED", sentAt: payDay } });
        await tx.payrollRun.update({ where: { id: run.id }, data: { payslipsSentAt: payDay } });
        await recordLoanRecoveries(tx, run.id);
        await recordGpf(tx, run.id, users.payroll.id);
      });
    }
  }
  await seedGpfOpenings(db, boardId, months, users.payroll.id);
}
