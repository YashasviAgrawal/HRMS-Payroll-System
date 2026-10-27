import "server-only";
import type { ApprovalTask } from "@/generated/prisma/client";
import { submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/session";
import { seal } from "@/lib/crypto";
import { db, type Tx } from "@/lib/db";
import { formatDate, fromISODate, shiftMonth } from "@/lib/dates";
import { badRequest, conflict, forbidden } from "@/lib/errors";
import { formatINR } from "@/lib/money";
import { emit } from "@/lib/outbox";
import { submitBulkRows } from "@/modules/employees/bulk";
import { submitOpening } from "@/modules/leave/opening";
import { applyNewPensioner, type newPensionerSchema } from "@/modules/pension/pensioners";
import { fyOfMonth } from "@/modules/statutory/tax-rules";
import { applyCarryIn } from "@/modules/statutory/tax";
import type { z } from "zod";
import { asOnMonth, buildTarget, mappingOf } from "./build";
import { canMapTarget } from "./mapping";
import { assertOpen } from "./staging";
import { splitName, TARGET_DEFS, type Options, type TargetKey } from "./targets";

/**
 * §15 step 8: loading what was mapped and cleaned. Nothing loads while an issue is open, and nothing loads without a
 * Checker: employees go as one EM-10 batch, leave balances as one LV-06 opening batch, GPF balances, loans, tax carried
 * in and pensioners as one migration batch each. Rows already loaded are skipped, so a second load never doubles.
 */
const n = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? 0 : Number(v));

type GpfRec = { employeeId: string; who: string; balance: number };
type LoanRec = { employeeId: string; who: string; type: string; principalLeft: number; interestLeft: number; instalment: number; interestRate: number; sanctionDate: string | null; orderNumber: string | null };
type TaxRec = { employeeId: string; who: string; salary: number; tds: number };
type PensionRec = Omit<z.infer<typeof newPensionerSchema>, "employeeId" | "bankAccount"> & {
  who: string;
  bankAccountEnc: string;
  bankAccountHash: string;
  bankAccountLast4: string;
  retiree: { code: string | null; name: string; gender: string; dob: string; doj: string; retired: string; died: string | null; sectionCode: string; postCode: string };
};
export type LoadPayload =
  | { target: "gpf"; asOn: string; records: GpfRec[] }
  | { target: "loans"; asOn: string; records: LoanRec[] }
  | { target: "tax"; fy: string; records: TaxRec[] }
  | { target: "pensioners"; records: PensionRec[] };

/** A load waiting for its Checker blocks a second one for the same target. */
async function pendingLoad(boardId: string, target: TargetKey) {
  const where =
    target === "employees"
      ? { kind: "employee.bulk_create", details: { path: ["source"], equals: "migration" } }
      : target === "leave"
        ? { kind: "leave.opening" }
        : { kind: "migration.load", entityType: "MigrationLoad", entityId: target };
  return db.approvalTask.findFirst({ where: { boardId, status: "PENDING", ...where } });
}

export async function loadState(boardId: string, target: TargetKey) {
  const task = await pendingLoad(boardId, target);
  return task ? { taskId: task.id, title: task.title, at: task.createdAt.toISOString() } : null;
}

export async function submitLoad(actor: Actor, target: TargetKey) {
  if (!TARGET_DEFS[target].loads) throw badRequest("migration.errors.notALoad");
  if (!canMapTarget(actor, target)) throw forbidden();
  await assertOpen(actor);
  const mapping = await mappingOf(actor.boardId, target);
  if (!mapping?.fileId) throw badRequest("migration.errors.notMapped");
  if (!mapping.signedAt) throw badRequest("migration.errors.notSigned");
  if (await pendingLoad(actor.boardId, target)) throw conflict("migration.errors.loadPending");
  const built = await buildTarget(actor, target);
  if (built.open) throw badRequest("migration.errors.openIssues", undefined, { n: built.open });
  if (!built.ready.length) throw badRequest("migration.errors.nothingToLoad");
  const options = (mapping.options ?? {}) as unknown as Options;
  const table = built.file?.tableName ?? "";

  if (target === "employees") {
    const rows = new Set(built.ready.map((r) => r.rowNo));
    const bulk = (built.bulk ?? []).filter((b) => rows.has(b.row));
    const res = await submitBulkRows(actor, bulk, `FoxPro ${table}`, { source: "migration" });
    return { count: res.count, taskId: res.taskId };
  }
  if (target === "leave") {
    const codes = built.fields.slice(1).map((f) => f.key);
    const flat = built.ready.flatMap((r) => codes.filter((c) => r.values[c] !== null).map((c) => ({ employeeId: r.employeeId!, leaveCode: c, days: n(r.values[c]) })));
    if (!flat.length) throw badRequest("migration.errors.nothingToLoad");
    const task = await submitOpening(actor, { asOn: options.asOn, rows: flat, note: `Brought from FoxPro (${table})` }, built.ready.length);
    return { count: built.ready.length, taskId: task.id };
  }

  let payload: LoadPayload;
  let rows: NonNullable<ApprovalDetails["rows"]>;
  if (target === "gpf") {
    const records = built.ready.map((r) => ({ employeeId: r.employeeId!, who: r.who, balance: n(r.values.balance) }));
    payload = { target, asOn: options.asOn!, records };
    rows = records.map((r) => ({ label: r.who, new: formatINR(r.balance) }));
  } else if (target === "loans") {
    const records = built.ready.map((r) => ({
      employeeId: r.employeeId!,
      who: r.who,
      type: r.values.loanType!,
      principalLeft: n(r.values.principalLeft),
      interestLeft: n(r.values.interestLeft),
      instalment: n(r.values.instalment),
      interestRate: n(r.values.interestRate),
      sanctionDate: r.values.sanctionDate,
      orderNumber: r.values.orderNumber,
    }));
    payload = { target, asOn: options.asOn!, records };
    rows = records.map((r) => ({ label: `${r.who} · ${r.type}`, new: `${formatINR(r.principalLeft)}${r.interestLeft ? ` + ${formatINR(r.interestLeft)} interest` : ""} @ ${formatINR(r.instalment)} a month` }));
  } else if (target === "tax") {
    const fy = options.fy ?? fyOfMonth(new Date().toISOString().slice(0, 7));
    const records = built.ready.map((r) => ({ employeeId: r.employeeId!, who: r.who, salary: n(r.values.salary), tds: n(r.values.tds) }));
    payload = { target, fy, records };
    rows = records.map((r) => ({ label: r.who, new: `${formatINR(r.salary)} · TDS ${formatINR(r.tds)}` }));
  } else {
    const sections = new Set((await db.section.findMany({ where: { boardId: actor.boardId }, select: { code: true } })).map((s) => s.code));
    const posts = new Set((await db.post.findMany({ where: { boardId: actor.boardId }, select: { code: true } })).map((p) => p.code));
    const records: PensionRec[] = built.ready.map((r) => {
      const v = r.values;
      const relation = (v.relation ?? (v.pensionType === "FAMILY" ? "SPOUSE" : "SELF")) as PensionRec["relation"];
      const sectionCode = v.retireeSection ?? options.sectionCode ?? "";
      const postCode = v.retireePost ?? options.postCode ?? "";
      if (!sections.has(sectionCode) || !posts.has(postCode)) throw badRequest("errors.validation", { sectionCode: "migration.errors.sectionPost" });
      const bank = seal("bank", v.bankAccount!.replace(/\s/g, ""));
      return {
        who: r.who,
        ppoNumber: v.ppoNumber!.toUpperCase(),
        type: v.pensionType as PensionRec["type"],
        relation,
        payeeName: v.payeeName!,
        payeeNameHi: v.payeeNameHi,
        payeeDob: v.payeeDob!,
        mobile: v.mobile ? v.mobile.replace(/\D/g, "").slice(-10) : null,
        ifsc: v.ifsc!.toUpperCase(),
        bankName: v.bankName,
        basicPension: n(v.basicPension),
        reducedPension: v.reducedPension ? n(v.reducedPension) : null,
        reducedFrom: v.reducedFrom,
        commutedAmount: n(v.commutedAmount),
        commutationDate: v.commutationDate,
        fmaEligible: v.fmaEligible !== "NO",
        startDate: v.startDate!,
        lastCertificate: v.lastCertificate,
        bankAccountEnc: bank.enc,
        bankAccountHash: bank.hash,
        bankAccountLast4: bank.last4,
        retiree: {
          code: v.retireeCode?.toUpperCase() ?? null,
          name: v.retireeName ?? v.payeeName!,
          gender: v.retireeGender!,
          dob: v.retireeDob ?? v.payeeDob!,
          doj: v.dateOfJoining!,
          retired: v.retirementDate!,
          died: v.deathDate,
          sectionCode,
          postCode,
        },
      };
    });
    payload = { target: "pensioners", records };
    rows = records.map((r) => ({ label: `${r.ppoNumber} · ${r.payeeName}`, new: `${formatINR(r.basicPension)} a month from ${formatDate(r.startDate)} · ••••${r.bankAccountLast4}` }));
  }
  const count = payload.records.length;
  const label = { gpf: ["GPF balances", "जीपीएफ शेष"], loans: ["Loans", "ऋण"], tax: ["Tax paid outside the system", "प्रणाली के बाहर दिया कर"], pensioners: ["Pensioners", "पेंशनभोगी"] }[payload.target];
  const task = await db.$transaction((tx) =>
    submitForApproval(tx, actor, {
      kind: "migration.load",
      title: `From FoxPro: ${label[0]} — ${count} ${count === 1 ? "record" : "records"} (${table})`,
      titleHi: `फॉक्सप्रो से: ${label[1]} — ${count} रिकॉर्ड (${table})`,
      details: { rows: rows.slice(0, 200), summary: rows.length > 200 ? `First 200 of ${rows.length} shown.` : `${rows.length} records.`, link: `/migration?tab=map&target=${target}` } satisfies ApprovalDetails,
      payload,
      entityType: "MigrationLoad",
      entityId: target,
    }),
  );
  await audit(db, actor, { action: "SUBMIT", entityType: "MigrationLoad", entityId: task.id, summary: `Sent ${count} ${target} records from ${table} for check` });
  return { count, taskId: task.id };
}

/** The Checker approved a migration batch: the records are created as they were checked. */
export async function applyLoad(tx: Tx, task: ApprovalTask, actor: Actor, p: LoadPayload) {
  const boardId = task.boardId;
  if (p.target === "gpf") {
    const month = asOnMonth(p.asOn);
    for (const r of p.records) {
      if (await tx.gpfEntry.findFirst({ where: { employeeId: r.employeeId, kind: "OPENING" } })) continue;
      await tx.gpfEntry.create({ data: { boardId, employeeId: r.employeeId, month, fy: fyOfMonth(month), kind: "OPENING", amount: r.balance, note: `Balance brought from FoxPro as on ${formatDate(p.asOn)}`, createdById: task.makerId } });
    }
  } else if (p.target === "loans") {
    const start = shiftMonth(asOnMonth(p.asOn), 1);
    for (const r of p.records) {
      const instalments = Math.max(1, Math.ceil((r.principalLeft + r.interestLeft) / r.instalment));
      await tx.loan.create({
        data: {
          boardId,
          employeeId: r.employeeId,
          type: r.type as never,
          purpose: `Brought from the old system as on ${formatDate(p.asOn)}`,
          principal: r.principalLeft,
          interestRate: r.interestRate,
          openingInterest: r.interestLeft,
          instalments,
          instalmentAmount: r.instalment,
          sanctionDate: fromISODate(r.sanctionDate ?? p.asOn),
          orderNumber: r.orderNumber,
          startMonth: start,
          status: "RUNNING",
          createdById: task.makerId,
          createdByName: task.makerName,
        },
      });
    }
  } else if (p.target === "tax") {
    for (const r of p.records) await applyCarryIn(tx, task, { employeeId: r.employeeId, fy: p.fy, salary: r.salary, tds: r.tds, note: "Paid through FoxPro before the cut-over" });
  } else {
    const sections = new Map((await tx.section.findMany({ where: { boardId }, select: { id: true, code: true } })).map((s) => [s.code, s.id]));
    const posts = new Map((await tx.post.findMany({ where: { boardId }, select: { id: true, code: true } })).map((s) => [s.code, s.id]));
    for (const r of p.records) {
      // The pension hangs on the service that earned it (D-41): the former employee is created when the old records have no record of them here.
      const existing = r.retiree.code ? await tx.employee.findFirst({ where: { boardId, employeeCode: r.retiree.code } }) : null;
      const names = splitName(r.retiree.name);
      const employee =
        existing ??
        (await tx.employee.create({
          data: {
            boardId,
            employeeCode: r.retiree.code,
            type: "PERMANENT_OPS",
            status: r.retiree.died ? "DECEASED" : "RETIRED",
            firstName: names.firstName,
            middleName: names.middleName || null,
            lastName: names.lastName || null,
            nameHi: r.relation === "SELF" ? (r.payeeNameHi ?? null) : null,
            gender: r.retiree.gender,
            dateOfBirth: fromISODate(r.retiree.dob),
            dateOfJoining: fromISODate(r.retiree.doj),
            dateOfRetirement: fromISODate(r.retiree.retired),
            exitDate: fromISODate(r.retiree.died ?? r.retiree.retired),
            exitReason: r.retiree.died ? "DEATH" : "RETIREMENT",
            sectionId: sections.get(r.retiree.sectionCode)!,
            postId: posts.get(r.retiree.postCode)!,
          },
        }));
      const { who: _who, retiree: _retiree, ...data } = r;
      void _who;
      void _retiree;
      await applyNewPensioner(tx, task, actor, { ...data, employeeId: employee.id } as never);
    }
  }
  await tx.approvalTask.update({ where: { id: task.id }, data: { entityId: p.target } });
  await audit(tx, actor, { action: "APPROVE", entityType: "MigrationLoad", entityId: task.id, summary: `Loaded ${p.records.length} ${p.target} records from FoxPro`, sensitive: p.target !== "tax" });
  await emit(tx, boardId, "migration.loaded", { type: "MigrationLoad", id: task.id }, { target: p.target, records: p.records.length });
}
