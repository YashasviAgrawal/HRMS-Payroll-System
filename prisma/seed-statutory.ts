/**
 * Statutory and tax (Module 8): the rules every installation starts with — income-tax slabs for this year and last, and
 * the statutory due dates — and, for the demo, the Board's portal identities, GPF balances brought from the old system,
 * a GPF advance and a few tax declarations.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { formatINR } from "../src/lib/money";
import { fromISODate, shiftMonth, todayIST } from "../src/lib/dates";
import { DUE_DEFAULTS } from "../src/modules/statutory/calendar";
import { gpfInstalment, monthsOfFy } from "../src/modules/statutory/gpf-rules";
import { buildStatFile, STAT_KINDS, SUM_LABEL } from "../src/modules/statutory/stat-build";
import { EMPTY_ITEMS, fyOfMonth, TAX_DEFAULTS, taxWorking, type DeclaredItems } from "../src/modules/statutory/tax-rules";
import { addParts, headFlags, monthsStillToCome, partsOf, ZERO_PARTS } from "../src/modules/statutory/tds-projection";
import { computeRun, RUN_GROUPS } from "../src/modules/payroll/compute";
import type { PayLine } from "../src/modules/payroll/engine";

/** Tax rules for this financial year and the last, and the due-date rules. Existing rows belong to the Board. */
export async function seedStatutoryRules(db: PrismaClient, boardId: string) {
  const fy = fyOfMonth(todayIST().slice(0, 7));
  const lastFy = fyOfMonth(shiftMonth(`${fy.slice(0, 4)}-04`, -1));
  for (const year of [lastFy, fy]) {
    for (const regime of ["NEW", "OLD"] as const) {
      const r = TAX_DEFAULTS[regime];
      await db.taxRule.upsert({
        where: { boardId_fy_regime: { boardId, fy: year, regime } },
        create: { boardId, fy: year, regime, slabs: r.slabs as unknown as Prisma.InputJsonValue, standardDeduction: r.standardDeduction, rebateIncomeLimit: r.rebateIncomeLimit, rebateMax: r.rebateMax, cessPercent: r.cessPercent },
        update: {},
      });
    }
  }
  for (const d of DUE_DEFAULTS) {
    await db.dueRule.upsert({ where: { boardId_code: { boardId, code: d.code } }, create: { boardId, ...d }, update: {} });
  }
}

type Who = { id: string; name: string };

/** [employee code, regime, items, status] — declarations for the year, made before the demo pay history. */
const DECLARATIONS: [string, "NEW" | "OLD", Partial<DeclaredItems>, "SUBMITTED" | "VERIFIED"][] = [
  ["DCB10001", "OLD", { sec80C: 150000, sec80D: 25000, homeLoanInterest: 200000 }, "VERIFIED"],
  ["DCB10013", "NEW", {}, "VERIFIED"],
  ["DCB10016", "OLD", { sec80C: 120000, sec80D: 18000, rentPaid: 216000 }, "VERIFIED"],
  ["DCB10017", "OLD", { sec80C: 150000, sec80D: 50000, sec80CCD1B: 50000, rentPaid: 300000 }, "SUBMITTED"],
];

/**
 * Before the demo pay history: the Board's statutory identities, tax declarations (one waiting for a Checker), and a
 * GPF advance drawn in the first history month, so the history recovers its instalments.
 */
export async function seedStatutoryBeforePayroll(db: PrismaClient, boardId: string, people: Map<string, string>, users: { payroll: Who; checker: Who }, months: string[]) {
  await db.setting.upsert({
    where: { boardId_key: { boardId, key: "statutory" } },
    create: {
      boardId,
      key: "statutory",
      value: {
        deductorName: "Delhi Cantonment Board",
        address: "Sadar Bazar, Delhi Cantonment, New Delhi 110010",
        tan: "DELC01234E",
        pan: "AAALC0123K",
        responsibleName: "Anil Sharma",
        responsibleDesignation: "Chief Executive Officer",
        ddoRegNo: "SGV012345C",
        epfCode: "DLCPM0012345000",
        esicCode: "11000123450001001",
        metroHra: true,
        professionalTax: false,
        ptSlabs: [
          { upTo: 7500, amount: 0 },
          { upTo: 10000, amount: 175 },
          { upTo: null, amount: 200 },
        ],
      },
      updatedById: users.payroll.id,
    },
    update: {},
  });

  const fy = fyOfMonth(months[0]);
  for (const [code, regime, items, status] of DECLARATIONS) {
    const employeeId = people.get(code);
    if (!employeeId) continue;
    const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
    const full = { ...EMPTY_ITEMS, ...items };
    const submittedAt = new Date(`${fy.slice(0, 4)}-04-20T06:00:00Z`);
    const decl = await db.taxDeclaration.create({
      data: {
        boardId,
        employeeId,
        fy,
        regime,
        items: full,
        status,
        submittedAt,
        ...(status === "VERIFIED" ? { verifiedById: users.checker.id, verifiedAt: new Date(`${fy.slice(0, 4)}-05-05T06:00:00Z`) } : {}),
      },
    });
    if (status === "SUBMITTED") {
      const name = [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" ");
      // Entered by HR & Accounts from the employee's paper form (Form 12BB).
      const maker = users.payroll;
      await db.approvalTask.create({
        data: {
          boardId,
          kind: "tax.declaration",
          title: `Tax declaration ${fy}: ${name} (${code}) — old regime`,
          titleHi: `कर घोषणा ${fy}: ${e.nameHi ?? name} (${code}) — पुरानी व्यवस्था`,
          details: {
            summary: "Check the amounts against the proofs. Verified amounts count for TDS from January.",
            summaryHi: "राशियाँ प्रमाणों से मिलाएँ। सत्यापित राशियाँ जनवरी से टीडीएस में गिनी जाती हैं।",
            link: `/statutory/declarations/${employeeId}`,
            rows: [
              { label: "Regime", labelHi: "व्यवस्था", new: "Old regime" },
              { label: "80C", new: formatINR(full.sec80C) },
              { label: "80D", new: formatINR(full.sec80D) },
              { label: "80CCD(1B)", new: formatINR(full.sec80CCD1B) },
              { label: "Rent paid in the year", labelHi: "वर्ष में दिया किराया", new: formatINR(full.rentPaid) },
            ],
          },
          payload: { declarationId: decl.id },
          requiredPermission: "CHECKER",
          subjectEmployeeId: employeeId,
          entityType: "TaxDeclaration",
          entityId: decl.id,
          makerId: maker.id,
          makerName: maker.name,
          makerNote: "Entered from the paper Form 12BB",
        },
      });
    }
  }

  // Salary and TDS of the year before the demo history, as the old system hands them over at cut-over (§15).
  const fyStart = monthsOfFy(fy)[0];
  const before = monthsOfFy(fy).filter((m) => m < months[0]).length;
  if (before > 0) {
    const codeOf = new Map([...people].map(([code, id]) => [id, code]));
    const declared = new Map(DECLARATIONS.map((d) => [d[0], d]));
    const flags = headFlags(await db.payHead.findMany({ where: { boardId } }));
    const ends = new Map((await db.employee.findMany({ where: { boardId }, select: { id: true, type: true, dateOfRetirement: true, contractEnd: true } })).map((e) => [e.id, (["CONTRACT", "DAILY_WAGE", "REEMPLOYED"].includes(e.type) ? e.contractEnd : e.dateOfRetirement)?.toISOString().slice(0, 10) ?? null]));
    const workedDays = 26;
    for (const group of RUN_GROUPS) {
      const computed = await computeRun(db, boardId, group, months[0], { ignoreAttendance: true, assumeWorkedDays: workedDays });
      for (const slip of computed.slips) {
        const parts = partsOf(slip.lines, flags);
        if (parts.gross <= 0) continue;
        const d = declared.get(codeOf.get(slip.employeeId) ?? "");
        const regime = d?.[1] ?? "NEW";
        // The year's tax on the months the person is on the rolls, spread evenly over them.
        const onRolls = before + 1 + monthsStillToCome(months[0], fy, ends.get(slip.employeeId) ?? null);
        const yearTax = (taxWorking(addParts(ZERO_PARTS, parts, onRolls), regime, { ...EMPTY_ITEMS, ...(d?.[2] ?? {}) }, TAX_DEFAULTS[regime]).total * before) / onRolls;
        await db.taxCarryIn.create({
          data: { boardId, employeeId: slip.employeeId, fy, salary: Math.round(parts.gross * before), tds: Math.round(yearTax), note: `Salary and TDS ${fyStart} to ${shiftMonth(months[0], -1)} brought from the old system`, createdById: users.payroll.id },
        });
      }
    }
  }

  // A GPF advance for Rajesh Kumar, drawn in the first history month and recovered from the next.
  const rajesh = people.get("DCB10008");
  if (rajesh) {
    const amount = 60000;
    const instalments = 24;
    const advance = await db.gpfAdvance.create({
      data: {
        boardId,
        employeeId: rajesh,
        kind: "ADVANCE",
        purpose: "Daughter's higher education (demo)",
        amount,
        instalments,
        instalmentAmount: gpfInstalment(amount, instalments),
        sanctionDate: fromISODate(`${months[0]}-10`),
        orderNumber: "DCB/Accts/GPF/41",
        startMonth: months[1],
        status: "RUNNING",
        createdById: users.payroll.id,
        createdByName: users.payroll.name,
      },
    });
    await db.gpfEntry.create({ data: { boardId, employeeId: rajesh, month: months[0], fy: fyOfMonth(months[0]), kind: "ADVANCE", amount: -amount, advanceId: advance.id, note: "Advance DCB/Accts/GPF/41", createdById: users.payroll.id } });
  }
}

/**
 * After the demo pay history: each GPF account gets its balance brought from the old system at the start of the year,
 * and the subscriptions of the months before the history (at the first history month's amount).
 */
export async function seedGpfOpenings(db: PrismaClient, boardId: string, months: string[], createdById: string) {
  const fy = fyOfMonth(months[0]);
  const fyStart = monthsOfFy(fy)[0];
  const slips = await db.payslip.findMany({ where: { boardId, month: months[0], run: { kind: "REGULAR" } }, include: { employee: { select: { id: true, dateOfJoining: true } } } });
  const rows: Prisma.GpfEntryCreateManyInput[] = [];
  for (const s of slips) {
    const gpf = (s.lines as unknown as PayLine[]).find((l) => l.code === "GPF")?.amount ?? 0;
    if (gpf <= 0) continue;
    const years = Math.min(25, Math.max(1, Number(fy.slice(0, 4)) - s.employee.dateOfJoining.getUTCFullYear()));
    const opening = Math.round((gpf * 12 * years * 1.4) / 1000) * 1000;
    rows.push({ boardId, employeeId: s.employeeId, month: fyStart, fy, kind: "OPENING", amount: opening, note: "Balance on 1 April brought from the old system", createdById });
    for (let m = fyStart; m < months[0]; m = shiftMonth(m, 1)) {
      rows.push({ boardId, employeeId: s.employeeId, month: m, fy, kind: "SUBSCRIPTION", amount: gpf, note: "Subscription brought from the old system", createdById });
    }
  }
  if (rows.length) await db.gpfEntry.createMany({ data: rows });
}

/** A generated file written where the app keeps them (same key shape as lib/storage). */
async function storeFile(area: string, buffer: Buffer, ext: string) {
  const now = new Date();
  const key = `${area}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomBytes(18).toString("base64url")}.${ext}`;
  const full = path.join(path.resolve(process.env.STORAGE_DIR ?? "./storage"), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buffer, { mode: 0o640 });
  return { key, sha256: createHash("sha256").update(buffer).digest("hex"), size: buffer.length };
}

/**
 * After the demo pay history, the office has done its filings for those months, as it would have: the TDS of each month
 * deposited by challan on the 5th, and the NPS, ECR, ESIC and pension fund files made and released by an Admin.
 */
export async function seedStatutoryHistory(db: PrismaClient, boardId: string, months: string[], users: { payroll: Who; signer: Who }) {
  let serial = 41;
  for (const month of months) {
    const slips = await db.payslip.findMany({ where: { boardId, month, status: "INCLUDED", run: { status: { in: ["APPROVED", "PAID", "CLOSED"] } } }, select: { lines: true } });
    const tds = slips.reduce((s, x) => s + (x.lines as unknown as PayLine[]).filter((l) => l.code === "IT").reduce((a, l) => a + l.amount, 0), 0);
    const next = shiftMonth(month, 1);
    if (tds > 0) {
      const cess = Math.round((tds * 4) / 104);
      await db.tdsChallan.create({ data: { boardId, fy: fyOfMonth(month), month, bsrCode: "0510308", challanNo: String(serial++).padStart(5, "0"), depositedOn: fromISODate(`${next}-05`), tax: tds - cess, cess, interest: 0, createdById: users.payroll.id } });
    }
    for (const kind of STAT_KINDS) {
      const b = await buildStatFile(db, boardId, kind, month);
      if (!b.ready || !b.rows.length) continue;
      const stored = await storeFile("files", Buffer.from(b.text, "utf8"), b.ext);
      const day = kind === "stat.pension" ? `${month}-28` : `${next}-0${kind === "stat.nps" ? 4 : 9}`;
      await db.fileRecord.create({
        data: {
          boardId,
          direction: "OUTGOING",
          kind,
          period: month,
          fileName: b.fileName,
          mimeType: b.mime,
          size: stored.size,
          sha256: stored.sha256,
          storageKey: stored.key,
          status: "DOWNLOADED",
          meta: JSON.parse(JSON.stringify({ preview: { columns: b.columns, rows: b.rows.slice(0, 50), totalRows: b.rows.length, totals: Object.fromEntries(b.sums.map(([k, v]) => [SUM_LABEL[k], formatINR(v)])) }, link: `/statutory/files?month=${month}` })),
          createdById: users.payroll.id,
          createdByName: users.payroll.name,
          approvedById: users.signer.id,
          approvedAt: new Date(`${day}T06:00:00Z`),
          downloadCount: 1,
          lastDownloadAt: new Date(`${day}T07:00:00Z`),
          createdAt: new Date(`${day}T05:00:00Z`),
        },
      });
    }
  }
}
