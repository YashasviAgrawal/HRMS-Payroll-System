import { beforeAll, describe, expect, it } from "vitest";
import { decide } from "@/lib/approvals/engine";
import { seal } from "@/lib/crypto";
import { db } from "@/lib/db";
import { loadFile } from "@/lib/storage";
import { shiftMonth, todayIST } from "@/lib/dates";
import { computeRun, saveRun, type RunGroup } from "@/modules/payroll/compute";
import type { PayLine } from "@/modules/payroll/engine";
import { proposePayItem } from "@/modules/payroll/rates";
import { calendarFor, resetReminderCheck, sendDueReminders } from "@/modules/statutory/calendar-service";
import { form16File, form16Year, generatePartB, importPartA, myForm16, proposePublish } from "@/modules/statutory/form16";
import { gpfAccount, proposeGpfInterest, sanctionGpfAdvance } from "@/modules/statutory/gpf";
import { recordGpf, undoGpf } from "@/modules/statutory/gpf-posting";
import { proposeTaxRule } from "@/modules/statutory/rules";
import { makeStatFile, monthFiles, reconcileCra } from "@/modules/statutory/stat-files";
import { getDeclaration, listDeclarations, myTax, saveMyDeclaration } from "@/modules/statutory/tax";
import { fyOfMonth, monthsLeftInFy, quarterOf, TAX_DEFAULTS } from "@/modules/statutory/tax-rules";
import { make24q, recordChallan, removeChallan, tdsYear } from "@/modules/statutory/tds";
import type { TaxDetail } from "@/modules/statutory/tds-projection";
import { seedPayrollRules } from "../../prisma/seed-payroll";
import { seedStatutoryRules } from "../../prisma/seed-statutory";
import { actorFor, hasTestDb, makeBoard, makePost, makeSection, makeUser } from "../support/factory";

type Actor = Awaited<ReturnType<typeof actorFor>>;
const pendingTask = (entityId: string) => db.approvalTask.findFirstOrThrow({ where: { entityId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
const PAN = "ABCPH1234K";

/** The last quarter that is over, as three months. */
function lastQuarter(today: string) {
  let m = today.slice(0, 7);
  while (quarterOf(m) === quarterOf(today.slice(0, 7)) && fyOfMonth(m) === fyOfMonth(today.slice(0, 7))) m = shiftMonth(m, -1);
  const q = quarterOf(m);
  const months = [shiftMonth(m, -2), shiftMonth(m, -1), m];
  return { q, months, fy: fyOfMonth(m) };
}

describe.skipIf(!hasTestDb)("statutory and tax (§9, ST-01 to ST-09)", () => {
  const today = todayIST();
  const quarter = lastQuarter(today);
  const [m1, m2, m3] = quarter.months;
  let boardId: string;
  const ids = { hi: "", nps: "", wk: "" };
  let payroll: Actor;
  let checker: Actor;
  let approver: Actor;
  let approver2: Actor;
  let hiUser: Actor;
  const runs: Record<string, string> = {};

  async function paidRun(group: RunGroup, month: string) {
    const computed = await computeRun(db, boardId, group, month, { ignoreAttendance: true, assumeWorkedDays: 26 });
    const run = await db.$transaction((tx) => saveRun(tx, payroll, group, month, computed));
    await db.payrollRun.update({ where: { id: run.id }, data: { status: "PAID", approvedAt: new Date(`${month}-26T07:00:00Z`), paidAt: new Date(`${month}-27T07:00:00Z`) } });
    await db.$transaction((tx) => recordGpf(tx, run.id));
    runs[`${group}|${month}`] = run.id;
    return run.id;
  }
  const slipOf = (runId: string, employeeId: string) => db.payslip.findFirstOrThrow({ where: { runId, employeeId } });
  const line = (lines: unknown, code: string) => (lines as PayLine[]).find((l) => l.code === code)?.amount ?? 0;

  beforeAll(async () => {
    boardId = (await makeBoard()).id;
    await seedPayrollRules(db, boardId);
    await seedStatutoryRules(db, boardId);
    const sectionId = (await makeSection(boardId)).id;
    const post12 = (await makePost(boardId, "12")).id;
    const post10 = (await makePost(boardId, "10")).id;
    const postW = (await makePost(boardId, "1")).id;
    const pan = seal("pan", PAN);
    const base = { boardId, status: "ACTIVE" as const, gender: "M", dateOfBirth: new Date("1975-05-05T00:00:00Z"), dateOfJoining: new Date("2001-01-01T00:00:00Z"), sectionId };
    const stamp = Date.now().toString(36).toUpperCase();
    ids.hi = (await db.employee.create({ data: { ...base, employeeCode: `ST1${stamp}`, type: "PERMANENT_OPS", firstName: "Tax", lastName: "Payer", postId: post12, payLevel: "12", payCell: 8, dateOfRetirement: new Date("2035-05-31T00:00:00Z"), panEnc: pan.enc, panHash: pan.hash, panLast4: pan.last4, gpfNumber: "DCB/GPF/T1" } })).id;
    ids.nps = (await db.employee.create({ data: { ...base, employeeCode: `ST2${stamp}`, type: "PERMANENT_NPS", firstName: "Nps", lastName: "Member", postId: post10, payLevel: "10", payCell: 3, dateOfRetirement: new Date("2035-05-31T00:00:00Z"), pran: "110022003300" } })).id;
    ids.wk = (await db.employee.create({ data: { ...base, employeeCode: `ST3${stamp}`, type: "CONTRACT", firstName: "Con", lastName: "Tract", postId: postW, wageRate: 18000, wageBasis: "MONTHLY", contractStart: new Date("2024-01-01T00:00:00Z"), contractEnd: new Date("2030-03-31T00:00:00Z"), uan: "100200300400", esicNumber: "2010203040" } })).id;
    payroll = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["PAYROLL"])).id);
    checker = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["CHECKER"])).id);
    approver = await actorFor((await makeUser(boardId, "ADMIN", ["APPROVER"])).id);
    approver2 = await actorFor((await makeUser(boardId, "ADMIN", ["APPROVER"])).id);
    hiUser = await actorFor((await makeUser(boardId, "EMPLOYEE", [], ids.hi)).id);
    await db.setting.upsert({
      where: { boardId_key: { boardId, key: "statutory" } },
      create: { boardId, key: "statutory", value: { tan: "DELC01234E", pan: "AAALC0123K", responsibleName: "Test Officer", ddoRegNo: "SGV000111C", epfCode: "DLCPM001", esicCode: "1100011" } },
      update: {},
    });
    // A GPF balance brought from the old system before the quarter.
    await db.gpfEntry.create({ data: { boardId, employeeId: ids.hi, month: shiftMonth(m1, -1), fy: fyOfMonth(shiftMonth(m1, -1)), kind: "OPENING", amount: 400000, note: "Opening" } });
  });

  it("ST-02/03: the employee chooses the old regime and declares; a Checker verifies it", async () => {
    await saveMyDeclaration(hiUser, { regime: "OLD", items: { sec80C: 150000, sec80D: 25000, sec80CCD1B: 0, homeLoanInterest: 200000, rentPaid: 0, otherIncome: 0 } });
    let mine = await myTax(hiUser);
    expect(mine.declaration).toMatchObject({ regime: "OLD", status: "DRAFT" });
    expect(mine.waitingForCheck).toBe(false);
    await saveMyDeclaration(hiUser, { regime: "OLD", items: { sec80C: 150000, sec80D: 25000, sec80CCD1B: 0, homeLoanInterest: 200000, rentPaid: 0, otherIncome: 0 }, submit: true });
    mine = await myTax(hiUser);
    expect(mine.declaration?.status).toBe("SUBMITTED");
    const decl = await db.taxDeclaration.findFirstOrThrow({ where: { employeeId: ids.hi } });
    const task = await pendingTask(decl.id);
    // The employee cannot verify it (own entry); the Checker can.
    await expect(decide(hiUser, task.id, "APPROVE")).rejects.toBeTruthy();
    await decide(checker, task.id, "APPROVE");
    expect((await db.taxDeclaration.findUniqueOrThrow({ where: { id: decl.id } })).status).toBe("VERIFIED");
    const list = await listDeclarations(checker, { fy: decl.fy });
    expect(list.rows.find((r) => r.employeeId === ids.hi)).toMatchObject({ regime: "OLD", status: "VERIFIED", declared: 375000 });
  });

  it("ST-04: TDS is projected on the year and spread over the months left; later months count what was deducted", async () => {
    // The declaration above is for this year; the quarter may be last year's — declare there too if so.
    if (quarter.fy !== fyOfMonth(today.slice(0, 7))) {
      await db.taxDeclaration.create({ data: { boardId, employeeId: ids.hi, fy: quarter.fy, regime: "OLD", items: { sec80C: 150000, sec80D: 25000, homeLoanInterest: 200000 }, status: "VERIFIED" } });
    }
    const r1 = await paidRun("OPS", m1);
    const s1 = await slipOf(r1, ids.hi);
    const t1 = (s1.detail as unknown as { tax: TaxDetail }).tax;
    expect(t1).toMatchObject({ fy: quarter.fy, regime: "OLD", basis: "VERIFIED", deductedSoFar: 0, monthsLeft: monthsLeftInFy(m1) });
    expect(t1.annualTax).toBeGreaterThan(0);
    expect(line(s1.lines, "IT")).toBe(t1.monthly);
    expect(t1.monthly).toBe(Math.round(t1.annualTax / t1.monthsLeft));
    const r2 = await paidRun("OPS", m2);
    const t2 = ((await slipOf(r2, ids.hi)).detail as unknown as { tax: TaxDetail }).tax;
    expect(t2.deductedSoFar).toBe(t1.monthly);
    expect(t2.monthsLeft).toBe(t1.monthsLeft - 1);
    expect(Math.abs(t2.monthly - t1.monthly)).toBeLessThanOrEqual(1);
    // The whole picture for HR & Accounts.
    const view = await getDeclaration(checker, ids.hi, quarter.fy);
    expect(view.workings.OLD.total).toBeGreaterThan(0);
    expect(view.chosen).toBe("OLD");
  });

  it("§9 GPF: subscriptions post from approved bills; the minimum and the yearly cap are enforced", async () => {
    const acct = await gpfAccount(payroll, ids.hi, quarter.fy);
    const subs = acct.entries.filter((e) => e.kind === "SUBSCRIPTION");
    expect(subs).toHaveLength(2);
    expect(subs[0].amount).toBe(line((await slipOf(runs[`OPS|${m1}`], ids.hi)).lines, "GPF"));
    expect(acct.balance).toBe(400000 + subs[0].amount * 2);
    await expect(proposePayItem(payroll, { employeeId: ids.hi, headCode: "GPF", amount: 1000, fromMonth: today.slice(0, 7) })).rejects.toMatchObject({ key: "payroll.errors.gpfMin" });
    await expect(proposePayItem(payroll, { employeeId: ids.hi, headCode: "GPF", amount: 90000, fromMonth: today.slice(0, 7) })).rejects.toMatchObject({ key: "payroll.errors.gpfCap" });
    await expect(proposePayItem(payroll, { employeeId: ids.nps, headCode: "GPF", amount: 9000, fromMonth: today.slice(0, 7) })).rejects.toMatchObject({ key: "payroll.errors.gpfOnlyOps" });
  });

  it("§9 GPF: an advance goes through a Checker and an Admin, is recovered by the next bill, and a reopen takes it back", async () => {
    await expect(sanctionGpfAdvance(payroll, { employeeId: ids.hi, kind: "ADVANCE", amount: 900000, instalments: 24, purpose: "House repair", orderNumber: "GPF/1", sanctionDate: today })).rejects.toMatchObject({ fields: { amount: "statutory.gpf.overLimit" } });
    await expect(sanctionGpfAdvance(payroll, { employeeId: ids.hi, kind: "ADVANCE", amount: 100000, instalments: 6, purpose: "House repair", orderNumber: "GPF/1", sanctionDate: today })).rejects.toBeTruthy();
    const a = await sanctionGpfAdvance(payroll, { employeeId: ids.hi, kind: "ADVANCE", amount: 100000, instalments: 24, purpose: "House repair", orderNumber: "GPF/1", sanctionDate: today });
    await expect(sanctionGpfAdvance(payroll, { employeeId: ids.hi, kind: "WITHDRAWAL", amount: 1000, instalments: 0, purpose: "Marriage", orderNumber: "GPF/2", sanctionDate: today })).rejects.toMatchObject({ key: "statutory.gpf.oneWaiting" });
    await decide(checker, (await pendingTask(a.id)).id, "APPROVE");
    expect((await db.gpfAdvance.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("PENDING");
    await decide(approver, (await pendingTask(a.id)).id, "APPROVE");
    const adv = await db.gpfAdvance.findUniqueOrThrow({ where: { id: a.id } });
    expect(adv).toMatchObject({ status: "RUNNING", startMonth: shiftMonth(today.slice(0, 7), 1) });
    expect(Number(adv.instalmentAmount)).toBe(4167);
    // Its recovery appears in the pay of the start month.
    await db.gpfAdvance.update({ where: { id: a.id }, data: { startMonth: m3 } });
    const r3 = await paidRun("OPS", m3);
    const s3 = await slipOf(r3, ids.hi);
    expect(line(s3.lines, "GPF_REFUND")).toBe(4167);
    expect(await db.gpfEntry.count({ where: { advanceId: a.id, kind: "REFUND" } })).toBe(1);
    await db.$transaction((tx) => undoGpf(tx, r3));
    expect(await db.gpfEntry.count({ where: { runId: r3 } })).toBe(0);
    await db.$transaction((tx) => recordGpf(tx, r3));
    expect(await db.gpfEntry.count({ where: { advanceId: a.id, kind: "REFUND" } })).toBe(1);
  });

  it("§9 GPF: interest is credited only for a finished year, once, after an Admin approves", async () => {
    const thisFy = fyOfMonth(today.slice(0, 7));
    await expect(proposeGpfInterest(payroll, thisFy)).rejects.toMatchObject({ key: "statutory.gpf.yearNotOver" });
    const past = "2021-22";
    await db.gpfEntry.createMany({ data: [
      { boardId, employeeId: ids.hi, month: "2021-04", fy: past, kind: "SUBSCRIPTION", amount: 12000 },
      { boardId, employeeId: ids.hi, month: "2021-10", fy: past, kind: "SUBSCRIPTION", amount: 12000 },
    ] });
    const task = await proposeGpfInterest(payroll, past);
    await expect(proposeGpfInterest(payroll, past)).rejects.toMatchObject({ key: "statutory.gpf.oneWaiting" });
    await decide(approver, task.id, "APPROVE");
    const credited = await db.gpfEntry.findFirstOrThrow({ where: { employeeId: ids.hi, fy: past, kind: "INTEREST" } });
    // 12,000 for six months, then 24,000 for six months, at 7.1% a year: (12,000 × 6 + 24,000 × 6) × 7.1 / 1200.
    expect(Number(credited.amount)).toBe(1278);
    expect(credited.month).toBe("2022-03");
    await expect(proposeGpfInterest(payroll, past)).rejects.toMatchObject({ key: "statutory.gpf.interestDone" });
  });

  it("ST-05/06: challans cover each month's TDS before the quarter's 24Q is built and released", async () => {
    const before = await tdsYear(payroll, quarter.fy);
    const q = before.quarters.find((x) => x.quarter === quarter.q)!;
    expect(q.ended).toBe(true);
    expect(q.short.length).toBeGreaterThan(0);
    await expect(make24q(payroll, quarter.fy, quarter.q)).rejects.toMatchObject({ key: "statutory.tds.challanShort" });
    for (const [i, m] of quarter.months.entries()) {
      const row = before.months.find((r) => r.month === m)!;
      if (!row || row.tds === 0) continue;
      const cess = Math.round((row.tds * 4) / 104);
      await recordChallan(payroll, { month: m, bsrCode: "0510308", challanNo: `0004${i}`, depositedOn: `${shiftMonth(m, 1)}-05`, tax: row.tds - cess, cess, interest: 0 });
    }
    await expect(recordChallan(payroll, { month: m1, bsrCode: "0510308", challanNo: "00040", depositedOn: `${shiftMonth(m1, 1)}-05`, tax: 10, cess: 0, interest: 0 })).rejects.toMatchObject({ key: "statutory.tds.challanExists" });
    await expect(recordChallan(payroll, { month: m1, bsrCode: "51030", challanNo: "1", depositedOn: `${shiftMonth(m1, 1)}-05`, tax: 10, cess: 0 })).rejects.toMatchObject({ issues: [expect.objectContaining({ message: "statutory.tds.bsrFormat" }), expect.objectContaining({ message: "statutory.tds.challanFormat" })] });
    const after = await tdsYear(payroll, quarter.fy);
    expect(after.months.filter((r) => quarter.months.includes(r.month) && r.tds > 0).every((r) => r.status === "DEPOSITED")).toBe(true);
    const file = await make24q(payroll, quarter.fy, quarter.q);
    const text = (await loadFile(file.storageKey)).toString("utf8");
    expect(text).toContain("^24Q^");
    expect(text).toContain(`^${PAN}^`);
    await expect(make24q(payroll, quarter.fy, quarter.q)).rejects.toMatchObject({ key: "statutory.files.waiting" });
    await decide(approver, (await pendingTask(file.id)).id, "APPROVE");
    const challan = await db.tdsChallan.findFirstOrThrow({ where: { boardId, month: m1 } });
    await expect(removeChallan(payroll, challan.id)).rejects.toMatchObject({ key: "statutory.tds.quarterFiled" });
  });

  it("ST-06/09: the month's NPS, ECR, ESIC and pension fund files are built from approved bills and released by an Admin", async () => {
    await expect(makeStatFile(payroll, "stat.nps", m2)).rejects.toMatchObject({ key: "statutory.files.payrollNotApproved" });
    await paidRun("NPS", m2);
    await paidRun("CONTRACT", m2);
    const view = await monthFiles(payroll, m2);
    const nps = view.cards.find((c) => c.kind === "stat.nps")!;
    expect(nps.ready).toBe(true);
    expect(nps.people).toBeGreaterThan(0);
    const file = await makeStatFile(payroll, "stat.nps", m2);
    const csv = (await loadFile(file.storageKey)).toString("utf8");
    expect(csv).toContain("110022003300");
    const npsSlip = await db.payslip.findFirstOrThrow({ where: { runId: runs[`NPS|${m2}`], employeeId: ids.nps } });
    expect(csv).toContain(`${line(npsSlip.lines, "NPS").toFixed(2)},${line(npsSlip.lines, "NPS_ER").toFixed(2)}`);
    await expect(makeStatFile(payroll, "stat.nps", m2)).rejects.toMatchObject({ key: "statutory.files.waiting" });
    const ecr = await makeStatFile(payroll, "stat.ecr", m2);
    const ecrText = (await loadFile(ecr.storageKey)).toString("utf8");
    expect(ecrText).toMatch(/^100200300400#~#CON TRACT#~#/m);
    const esic = await makeStatFile(payroll, "stat.esic", m2);
    expect((await loadFile(esic.storageKey)).toString("utf8")).toContain("2010203040");
    const pension = await makeStatFile(payroll, "stat.pension", m2);
    expect((await loadFile(pension.storageKey)).toString("utf8")).toContain("Board contribution");
    await decide(approver, (await pendingTask(file.id)).id, "APPROVE");
    expect((await monthFiles(payroll, m2)).cards.find((c) => c.kind === "stat.nps")!.latest?.status).toBe("APPROVED");
  });

  it("§9 NPS: the CRA statement is matched PRAN by PRAN with the pay bills", async () => {
    const slip = await db.payslip.findFirstOrThrow({ where: { runId: runs[`NPS|${m2}`], employeeId: ids.nps } });
    const own = line(slip.lines, "NPS");
    const board = line(slip.lines, "NPS_ER");
    const mm = `${m2.slice(5, 7)}${m2.slice(0, 4)}`;
    const ok = await reconcileCra(payroll, "cra.csv", Buffer.from(`PRAN,Contribution Month,Employee Contribution,Employer Contribution\n110022003300,${mm},${own},${board}\n999988887777,${mm},100,140\n`));
    expect(ok.lines.find((l) => l.pran === "110022003300")!.status).toBe("MATCHED");
    expect(ok.lines.find((l) => l.pran === "999988887777")!.status).toBe("NOT_OURS");
    const off = await reconcileCra(payroll, "cra2.csv", Buffer.from(`PRAN,Month,Employee,Employer\n110022003300,${m2},${own - 50},${board}\n`));
    expect(off.lines.find((l) => l.pran === "110022003300")).toMatchObject({ status: "DIFFERENT", cra: { employee: own - 50 } });
    await expect(reconcileCra(payroll, "bad.csv", Buffer.from("a,b\n1,2\n"))).rejects.toMatchObject({ key: "statutory.nps.badStatement" });
  });

  it("ST-07: Part B is generated, Part A matched by PAN, and the year published to the employee after an Admin approves", async () => {
    // A finished year with pay for the taxpayer: the March before this financial year.
    const thisFy = fyOfMonth(today.slice(0, 7));
    const march = `${thisFy.slice(0, 4)}-03`;
    const pastFy = fyOfMonth(march);
    if (!runs[`OPS|${march}`]) await paidRun("OPS", march);
    const made = await generatePartB(payroll, pastFy);
    expect(made.draft).toBe(false);
    const year = await form16Year(payroll, pastFy);
    const row = year.rows.find((r) => r.employeeId === ids.hi)!;
    expect(row).toMatchObject({ partB: true, partA: false, published: false });
    const pdf = new File([Buffer.from("%PDF-1.4\n% Part A\n")], `${PAN}_${pastFy}.pdf`, { type: "application/pdf" });
    const nopan = new File([Buffer.from("%PDF-1.4\n")], `partA-unknown.pdf`, { type: "application/pdf" });
    const imported = await importPartA(payroll, pastFy, [pdf, nopan]);
    expect(imported.matched.map((m) => m.file)).toEqual([`${PAN}_${pastFy}.pdf`]);
    expect(imported.unmatched).toEqual([{ file: "partA-unknown.pdf", reason: "noPan" }]);
    await expect(proposePublish(payroll, thisFy)).rejects.toMatchObject({ key: "statutory.form16.yearNotOver" });
    expect(await myForm16(hiUser)).toEqual([]);
    const task = await proposePublish(payroll, pastFy);
    await decide(approver2, task.id, "APPROVE");
    const mine = await myForm16(hiUser);
    expect(mine).toEqual([expect.objectContaining({ fy: pastFy, partA: true, partB: true })]);
    const partB = await form16File(hiUser, mine[0].id, "B");
    expect(partB.buffer.subarray(0, 4).toString()).toBe("%PDF");
    await expect(generatePartB(payroll, pastFy)).rejects.toMatchObject({ key: "statutory.form16.alreadyPublished" });
  });

  it("ST-08: the calendar marks a month's TDS done once deposited, and reminders go once, 5 days ahead", async () => {
    const items = await calendarFor(boardId, `${shiftMonth(m1, 1)}-01`, `${shiftMonth(m3, 1)}-28`, today);
    const tdsItems = items.filter((i) => i.code === "TDS_DEPOSIT" && quarter.months.includes(i.period));
    expect(tdsItems.length).toBeGreaterThan(0);
    expect(tdsItems.every((i) => i.state === "DONE" || i.state === "NOTHING")).toBe(true);
    // Pick a day 5 days before an upcoming open due date and remind.
    resetReminderCheck();
    const ahead = await calendarFor(boardId, today, `${shiftMonth(today.slice(0, 7), 2)}-28`, today);
    const open = ahead.find((i) => i.state === "OPEN" && i.code === "FORM_24Q") ?? ahead.find((i) => i.state === "OPEN")!;
    const day = new Date(`${open.dueOn}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() - 5);
    const remindOn = day.toISOString().slice(0, 10);
    const sent = await sendDueReminders(boardId, remindOn);
    expect(sent).toBeGreaterThan(0);
    expect(await db.dueReminder.count({ where: { boardId, code: open.code } })).toBeGreaterThan(0);
    resetReminderCheck();
    expect(await sendDueReminders(boardId, remindOn)).toBe(0);
  });

  it("ST-01: tax slabs change only through an Admin, and must go up", async () => {
    const fy = fyOfMonth(today.slice(0, 7));
    const base = { fy, regime: "NEW" as const, standardDeduction: 75000, rebateIncomeLimit: 1200000, rebateMax: 60000, cessPercent: 4, reason: "Finance Act (test)" };
    await expect(proposeTaxRule(payroll, { ...base, slabs: [{ upTo: 800000, rate: 0 }, { upTo: 400000, rate: 5 }, { upTo: null, rate: 30 }] })).rejects.toMatchObject({ issues: [expect.objectContaining({ message: "statutory.rules.slabOrder" })] });
    const task = await proposeTaxRule(payroll, { ...base, slabs: [{ upTo: 500000, rate: 0 }, { upTo: 1000000, rate: 10 }, { upTo: null, rate: 30 }] });
    await decide(approver, task.id, "APPROVE");
    const row = await db.taxRule.findUniqueOrThrow({ where: { boardId_fy_regime: { boardId, fy, regime: "NEW" } } });
    expect(row.version).toBe(2);
    expect((row.slabs as { upTo: number | null }[])[0].upTo).toBe(500000);
    // Put the year's real slabs back for the test files that run after this one.
    await db.taxRule.update({ where: { id: row.id }, data: { slabs: TAX_DEFAULTS.NEW.slabs as unknown as object[] } });
  });
});

