/**
 * Pension (Module 9): the commutation table every installation starts with and, for the demo, pensioners brought over
 * from the old system — a retiree with a login, an 80-plus family pensioner with a login of her own, an 86-year-old
 * whose pension is held for want of a life certificate (a Jeevan Pramaan certificate waiting to be checked), a recent
 * retiree on CGHS, and a family pension at the enhanced rate after a death in service — with two closed pension bills
 * worked out by the real pension engine.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import type { PensionType } from "../src/generated/prisma/enums";
import { addDays, fromISODate, shiftMonth } from "../src/lib/dates";
import { saveRun } from "../src/modules/payroll/compute";
import { COMMUTATION_FACTORS_2008, factorFor, ageNextBirthday } from "../src/modules/pension/calculator";
import { computePensionRun } from "../src/modules/pension/compute";

type Who = { id: string; name: string };
type Seal = (kind: "bank" | "pan" | "aadhaar", value: string) => { enc: string; hash: string; last4: string };

/** The commutation table (CCS (Commutation of Pension) Rules, from 2 September 2008). Edited later through Admin approval. */
export async function seedPensionRules(db: PrismaClient, boardId: string) {
  await db.ruleTable.upsert({
    where: { boardId_code_effectiveFrom: { boardId, code: "COMMUTATION_FACTORS", effectiveFrom: fromISODate("2008-09-02") } },
    create: { boardId, code: "COMMUTATION_FACTORS", effectiveFrom: fromISODate("2008-09-02"), data: COMMUTATION_FACTORS_2008, note: "CCS (Commutation of Pension) Rules — table from 2 September 2008" },
    update: {},
  });
}

type DemoRetiree = {
  code: string;
  first: string;
  last: string;
  hi: string;
  gender: "M" | "F";
  dob: string;
  doj: string;
  lastDay: string;
  status: "RETIRED" | "DECEASED";
  exitReason: string;
  section: string;
  post: string;
};

type DemoPension = {
  employee: string;
  ppo: string;
  type: PensionType;
  relation: string;
  payee: string;
  payeeHi: string;
  payeeDob: string;
  mobile: string | null;
  basic: number;
  reduced?: { amount: number; from: string };
  commuted?: { amount: number; on: string };
  fma: boolean;
  start: string;
  end?: { on: string; reason: string };
  previous?: string;
  account: string;
  ifsc: string;
  bank: string;
  /** [date, source, status, Jeevan Pramaan ID] */
  certificates: [string, "MANUAL" | "JEEVAN_PRAMAAN", "VERIFIED" | "SUBMITTED", string | null][];
  login?: { loginId: string; mobile: string; language: "en" | "hi" };
};

const RETIREES: DemoRetiree[] = [
  { code: "DCB09001", first: "Balbir", last: "Singh", hi: "बलबीर सिंह", gender: "M", dob: "1956-01-15", doj: "1981-03-02", lastDay: "2016-01-31", status: "RETIRED", exitReason: "Superannuation", section: "ADM", post: "OS" },
  { code: "DCB09002", first: "Hari", last: "Ram", hi: "हरि राम", gender: "M", dob: "1944-06-01", doj: "1968-04-10", lastDay: "2004-06-30", status: "DECEASED", exitReason: "Superannuation; died 16 March 2012 as a pensioner", section: "HLT", post: "SK" },
  { code: "DCB09003", first: "Dharam", last: "Pal", hi: "धरम पाल", gender: "M", dob: "1940-06-20", doj: "1962-09-01", lastDay: "2000-06-30", status: "RETIRED", exitReason: "Superannuation", section: "HRT", post: "MALI" },
  { code: "DCB09004", first: "Jagdish", last: "Prasad", hi: "जगदीश प्रसाद", gender: "M", dob: "1964-03-10", doj: "1989-07-03", lastDay: "2024-03-31", status: "RETIRED", exitReason: "Superannuation", section: "ENG", post: "AE" },
  { code: "DCB09005", first: "Naresh", last: "Kumar", hi: "नरेश कुमार", gender: "M", dob: "1971-02-02", doj: "1998-01-05", lastDay: "2022-05-14", status: "DECEASED", exitReason: "Died in service", section: "ENG", post: "JE" },
];

const PENSIONS: DemoPension[] = [
  {
    employee: "DCB09001", ppo: "DCB/PPO/2016/0007", type: "SUPERANNUATION", relation: "SELF", payee: "Balbir Singh", payeeHi: "बलबीर सिंह", payeeDob: "1956-01-15", mobile: "9810000201",
    basic: 31050, commuted: { amount: 12420, on: "2016-02-01" }, fma: true, start: "2016-02-01", account: "40211000781", ifsc: "SBIN0001234", bank: "State Bank of India",
    certificates: [["2024-11-08", "MANUAL", "VERIFIED", null], ["2025-11-10", "MANUAL", "VERIFIED", null]],
    login: { loginId: "DCB09001", mobile: "9810000201", language: "en" },
  },
  {
    employee: "DCB09002", ppo: "DCB/PPO/2004/0012", type: "SUPERANNUATION", relation: "SELF", payee: "Hari Ram", payeeHi: "हरि राम", payeeDob: "1944-06-01", mobile: null,
    basic: 9000, commuted: { amount: 1150, on: "2004-07-01" }, fma: true, start: "2004-07-01", end: { on: "2012-03-16", reason: "Died on 16 March 2012" }, account: "30121004415", ifsc: "PUNB0123400", bank: "Punjab National Bank",
    certificates: [["2011-11-14", "MANUAL", "VERIFIED", null]],
  },
  {
    employee: "DCB09002", ppo: "DCB/PPO/2012/0031", type: "FAMILY", relation: "SPOUSE", payee: "Kamla Devi", payeeHi: "कमला देवी", payeeDob: "1946-03-08", mobile: "9810000202",
    basic: 9000, fma: true, start: "2012-03-17", previous: "DCB/PPO/2004/0012", account: "30121009921", ifsc: "PUNB0123400", bank: "Punjab National Bank",
    certificates: [["2024-11-12", "JEEVAN_PRAMAAN", "VERIFIED", "JP-2024-7731045"], ["2025-11-04", "JEEVAN_PRAMAAN", "VERIFIED", "JP-2025-8812093"]],
    login: { loginId: "DCB/PPO/2012/0031", mobile: "9810000202", language: "hi" },
  },
  {
    employee: "DCB09003", ppo: "DCB/PPO/2000/0004", type: "SUPERANNUATION", relation: "SELF", payee: "Dharam Pal", payeeHi: "धरम पाल", payeeDob: "1940-06-20", mobile: "9810000203",
    basic: 11850, commuted: { amount: 3950, on: "2000-07-01" }, fma: true, start: "2000-07-01", account: "40211000342", ifsc: "SBIN0001234", bank: "State Bank of India",
    certificates: [["2024-11-18", "MANUAL", "VERIFIED", null], ["2026-10-21", "JEEVAN_PRAMAAN", "SUBMITTED", "JP-2026-9034417"]],
  },
  {
    employee: "DCB09004", ppo: "DCB/PPO/2024/0019", type: "SUPERANNUATION", relation: "SELF", payee: "Jagdish Prasad", payeeHi: "जगदीश प्रसाद", payeeDob: "1964-03-10", mobile: "9810000204",
    basic: 52450, commuted: { amount: 20980, on: "2024-04-01" }, fma: false, start: "2024-04-01", account: "50100234418820", ifsc: "HDFC0000123", bank: "HDFC Bank",
    certificates: [["2024-11-20", "MANUAL", "VERIFIED", null], ["2025-11-20", "MANUAL", "VERIFIED", null]],
  },
  {
    employee: "DCB09005", ppo: "DCB/PPO/2022/0023", type: "FAMILY", relation: "SPOUSE", payee: "Usha Rani", payeeHi: "उषा रानी", payeeDob: "1975-08-19", mobile: "9810000205",
    basic: 21950, reduced: { amount: 13170, from: "2032-05-15" }, fma: true, start: "2022-05-15", account: "40211000915", ifsc: "SBIN0001234", bank: "State Bank of India",
    certificates: [["2024-12-03", "MANUAL", "VERIFIED", null], ["2025-12-02", "MANUAL", "VERIFIED", null]],
  },
];

/** Demo: retirees from the old system, their pensions and life certificates, and two closed pension bills. */
export async function seedPensionDemo(
  db: PrismaClient,
  boardId: string,
  opts: { seal: Seal; sections: Map<string, string>; posts: Map<string, { id: string }>; months: string[]; users: { pension: Who; checker: Who; signer: Who }; passwordHash: string },
) {
  if ((await db.pensioner.count({ where: { boardId } })) > 0) return;
  const { seal, users } = opts;
  const employeeIds = new Map<string, string>();
  for (const r of RETIREES) {
    const e = await db.employee.create({
      data: {
        boardId,
        employeeCode: r.code,
        type: "PERMANENT_OPS",
        status: r.status,
        firstName: r.first,
        lastName: r.last,
        nameHi: r.hi,
        gender: r.gender,
        dateOfBirth: fromISODate(r.dob),
        dateOfJoining: fromISODate(r.doj),
        dateOfRetirement: fromISODate(r.lastDay),
        exitDate: fromISODate(r.lastDay),
        exitReason: r.exitReason,
        sectionId: opts.sections.get(r.section)!,
        postId: opts.posts.get(r.post)!.id,
        gpfNumber: `DCB/GPF/${r.code.slice(-3)}`,
        maritalStatus: "MARRIED",
        createdById: "seed",
      },
    });
    employeeIds.set(r.code, e.id);
    await db.serviceBookEntry.create({
      data: { employeeId: e.id, event: "APPOINTMENT", eventDate: fromISODate(r.doj), details: "Appointment (brought over from the old records).", detailsHi: "नियुक्ति (पुराने अभिलेख से)।", status: "APPROVED", createdById: "seed" },
    });
  }
  const pensionerIds = new Map<string, string>();
  for (const p of PENSIONS) {
    const bank = seal("bank", p.account);
    const lumpSum = p.commuted ? Math.round(p.commuted.amount * 12 * factorFor(COMMUTATION_FACTORS_2008, ageNextBirthday(p.payeeDob, p.commuted.on))) : null;
    const row = await db.pensioner.create({
      data: {
        boardId,
        employeeId: employeeIds.get(p.employee)!,
        ppoNumber: p.ppo,
        type: p.type,
        status: p.end ? "STOPPED" : "ACTIVE",
        relation: p.relation,
        payeeName: p.payee,
        payeeNameHi: p.payeeHi,
        payeeDob: fromISODate(p.payeeDob),
        mobile: p.mobile,
        basicPension: p.basic,
        reducedPension: p.reduced?.amount ?? null,
        reducedFrom: p.reduced ? fromISODate(p.reduced.from) : null,
        commutedAmount: p.commuted?.amount ?? 0,
        commutationDate: p.commuted ? fromISODate(p.commuted.on) : null,
        commutationLumpSum: lumpSum,
        fmaEligible: p.fma,
        startDate: fromISODate(p.start),
        endDate: p.end ? fromISODate(p.end.on) : null,
        endReason: p.end?.reason ?? null,
        bankAccountEnc: bank.enc,
        bankAccountHash: bank.hash,
        bankAccountLast4: bank.last4,
        ifsc: p.ifsc,
        bankName: p.bank,
        previousId: p.previous ? pensionerIds.get(p.previous)! : null,
        createdById: users.pension.id,
      },
    });
    pensionerIds.set(p.ppo, row.id);
    for (const [on, source, status, jpId] of p.certificates) {
      const cert = await db.lifeCertificate.create({
        data: {
          boardId,
          pensionerId: row.id,
          source,
          status,
          certifiedOn: fromISODate(on),
          jpId,
          note: source === "MANUAL" ? "Signed before the Pension clerk at the Board office" : null,
          enteredById: status === "SUBMITTED" ? "jeevan-pramaan" : users.pension.id,
          verifiedById: status === "VERIFIED" ? users.pension.id : null,
          verifiedAt: status === "VERIFIED" ? fromISODate(addDays(on, 2)) : null,
          createdAt: fromISODate(on),
        },
      });
      // An upload from Jeevan Pramaan waits in the Pension clerk's approvals.
      if (status === "SUBMITTED") {
        await db.approvalTask.create({
          data: {
            boardId,
            kind: "pension.lifecert",
            title: `Life certificate from ${p.payee} (PPO ${p.ppo})`,
            titleHi: `${p.payeeHi} का जीवन प्रमाण पत्र (पीपीओ ${p.ppo})`,
            details: { rows: [{ label: "Jeevan Pramaan ID", labelHi: "जीवन प्रमाण आईडी", new: jpId }, { label: "Date on the certificate", labelHi: "प्रमाण पत्र की तिथि", new: on }], link: `/pension/pensioners/${row.id}`, summary: "Open the certificate from the pensioner's page and check the name, PPO and date.", summaryHi: "पेंशनभोगी के पृष्ठ से प्रमाण पत्र खोलें और नाम, पीपीओ और तिथि जाँचें।" },
            payload: { certificateId: cert.id },
            requiredPermission: "PENSION",
            subjectEmployeeId: employeeIds.get(p.employee)!,
            entityType: "Pensioner",
            entityId: row.id,
            makerId: "jeevan-pramaan",
            makerName: "Jeevan Pramaan",
            createdAt: fromISODate(on),
          },
        });
      }
    }
    if (p.login) {
      await db.user.create({
        data: {
          boardId,
          loginType: "EMPLOYEE",
          loginId: p.login.loginId,
          displayName: p.payee,
          displayNameHi: p.payeeHi,
          mobile: p.login.mobile,
          language: p.login.language,
          // A retiree keeps the login of their service; a family pensioner gets one of their own (PN-12).
          ...(p.relation === "SELF" ? { employeeId: employeeIds.get(p.employee)! } : { pensionerId: row.id }),
          passwordHash: opts.passwordHash,
          mustChangePassword: false,
          permissions: [],
        },
      });
    }
  }
  // The family pensioners' spouse records and the retirees' spouses (for a family pension later).
  const spouse = async (code: string, name: string, dob: string, gender: "M" | "F") =>
    db.familyMember.create({ data: { employeeId: employeeIds.get(code)!, name, relation: "SPOUSE", gender, dateOfBirth: fromISODate(dob), isDependent: true } });
  await spouse("DCB09001", "Smt. Kaushalya Devi", "1959-09-12", "F");
  await spouse("DCB09002", "Smt. Kamla Devi", "1946-03-08", "F");
  await spouse("DCB09004", "Smt. Saroj Prasad", "1967-01-25", "F");
  await spouse("DCB09005", "Smt. Usha Rani", "1975-08-19", "F");

  // Two closed pension bills, worked out by the pension engine — the months before this one.
  for (const [mi, month] of opts.months.entries()) {
    const computed = await computePensionRun(db, boardId, month);
    if (!computed.slips.length) continue;
    await db.$transaction(async (tx) => {
      const run = await saveRun(tx, { boardId, userId: users.pension.id, name: users.pension.name }, "PENSION", month, computed);
      await tx.payrollException.updateMany({ where: { runId: run.id, resolution: null }, data: { resolution: "EXPLAINED", note: "Checked (demo history)", resolvedById: users.pension.id, resolvedByName: users.pension.name, resolvedAt: new Date() } });
      const day = (d: number) => fromISODate(`${shiftMonth(month, 1)}-0${d}`);
      const payDay = new Date(`${month}-${mi === 0 ? 28 : 27}T06:30:00Z`);
      await tx.payrollRun.update({
        where: { id: run.id },
        data: {
          status: "CLOSED",
          runAt: new Date(`${month}-22T05:30:00Z`),
          submittedAt: new Date(`${month}-22T09:00:00Z`),
          checkedById: users.checker.id,
          checkedByName: users.checker.name,
          approvedById: users.signer.id,
          approvedByName: users.signer.name,
          approvedAt: new Date(`${month}-25T07:00:00Z`),
          paidAt: payDay,
          returnAt: day(2),
          closedAt: day(3),
          payslipsSentAt: payDay,
        },
      });
      await tx.payslip.updateMany({ where: { runId: run.id, status: "INCLUDED" }, data: { creditStatus: "CREDITED", sentAt: payDay } });
    });
  }
}
