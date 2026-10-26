import "server-only";
import { Prisma, type Employee } from "@/generated/prisma/client";
import { submitForApproval, pendingFor } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import { canAll, canSeeSensitive, scopeFor } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { decrypt, seal } from "@/lib/crypto";
import { db, type Tx } from "@/lib/db";
import { completedYears, fromISODate, retirementDate, todayIST, toISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { basicPay } from "@/modules/payroll/matrix-7cpc";
import { addressLine, displayValue, fieldLabel, fullName, maskedIds } from "./present";
import {
  createEmployeeSchema,
  crossCheck,
  idsSchema,
  isMatrixType,
  isWageType,
  jobSchema,
  personalSchema,
  type CreateEmployeeInput,
  type IdsInput,
  type JobInput,
  type PersonalInput,
} from "./schema";

export const ACTIVE_STATUSES = ["DRAFT", "ACTIVE", "SUSPENDED"] as const;
const SENSITIVE = { pan: "pan", aadhaar: "aadhaar", bankAccount: "bank" } as const;
type SensitiveField = keyof typeof SENSITIVE;

// ── access ──────────────────────────────────────────────────────────────────

/** Can this actor see this employee's record? (§14: HR/Payroll/Pension/Checker/Approver all, reporting officer own section, employee own.) */
export function canViewEmployee(actor: Actor, e: Pick<Employee, "id" | "sectionId">) {
  const scope = scopeFor(actor, "employee_master", "view");
  if (scope === "all") return true;
  if (scope === "section") {
    if (actor.sectionId && e.sectionId === actor.sectionId) return true;
  }
  return actor.employeeId === e.id && (scope === "own" || scope === "section");
}

function assertHr(actor: Actor) {
  if (!canAll(actor, "employee_master", "create")) throw forbidden();
}

/** Who may see full PAN / bank numbers (to verify against documents). Aadhaar is never shown in full. */
export function canRevealIds(actor: Actor) {
  return canSeeSensitive(actor) && actor.permissions.some((p) => ["HR", "CHECKER", "PAYROLL", "APPROVER"].includes(p));
}

// ── read ────────────────────────────────────────────────────────────────────

const viewInclude = {
  section: { select: { id: true, name: true, nameHi: true } },
  post: { select: { id: true, name: true, nameHi: true, payLevel: true, group: true, retirementAge: true } },
} satisfies Prisma.EmployeeInclude;

type EmployeeWithRefs = Prisma.EmployeeGetPayload<{ include: typeof viewInclude }>;

const iso = (d: Date | null | undefined) => (d ? toISODate(d) : null);

export function toView(e: EmployeeWithRefs, actor: Actor) {
  const showSensitive = canSeeSensitive(actor);
  const masked = maskedIds(e);
  return {
    id: e.id,
    employeeCode: e.employeeCode,
    status: e.status,
    type: e.type,
    name: fullName(e),
    firstName: e.firstName,
    middleName: e.middleName,
    lastName: e.lastName,
    nameHi: e.nameHi,
    gender: e.gender,
    dateOfBirth: iso(e.dateOfBirth)!,
    dateOfJoining: iso(e.dateOfJoining)!,
    dateOfRetirement: iso(e.dateOfRetirement),
    exitDate: iso(e.exitDate),
    exitReason: e.exitReason,
    section: e.section,
    post: e.post,
    payLevel: e.payLevel,
    payCell: e.payCell,
    basicPay: showSensitive ? basicPay(e.payLevel, e.payCell) : null,
    mobile: e.mobile,
    email: e.email,
    fatherOrSpouseName: e.fatherOrSpouseName,
    category: e.category,
    maritalStatus: e.maritalStatus,
    bloodGroup: e.bloodGroup,
    isDisabled: e.isDisabled,
    presentAddress: e.presentAddress as Record<string, string> | null,
    permanentAddress: e.permanentAddress as Record<string, string> | null,
    probationEndDate: iso(e.probationEndDate),
    confirmationDate: iso(e.confirmationDate),
    agencyName: e.agencyName,
    wageRate: showSensitive && e.wageRate ? Number(e.wageRate) : null,
    wageBasis: e.wageBasis,
    contractStart: iso(e.contractStart),
    contractEnd: iso(e.contractEnd),
    biometricId: e.biometricId,
    ids: showSensitive
      ? {
          pan: masked.pan,
          aadhaar: masked.aadhaar,
          bankAccount: masked.bankAccount,
          pran: e.pran,
          uan: e.uan,
          esicNumber: e.esicNumber,
          gpfNumber: e.gpfNumber,
          ifsc: e.ifsc,
          bankName: e.bankName,
          bankBranch: e.bankBranch,
        }
      : null,
    serviceYears: completedYears(iso(e.dateOfJoining)!, todayIST()),
    updatedAt: e.updatedAt.toISOString(),
  };
}

export type EmployeeView = ReturnType<typeof toView>;

export async function getEmployee(actor: Actor, id: string) {
  const e = await db.employee.findFirst({ where: { id, boardId: actor.boardId }, include: viewInclude });
  if (!e || !canViewEmployee(actor, e)) throw notFound();
  return toView(e, actor);
}

export interface EmployeeFilter {
  q?: string;
  sectionId?: string;
  type?: string;
  payLevel?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export async function listEmployees(actor: Actor, f: EmployeeFilter = {}) {
  const scope = scopeFor(actor, "employee_master", "view");
  if (scope !== "all" && scope !== "section") throw forbidden();
  const pageSize = Math.min(f.pageSize ?? 25, 200);
  const page = Math.max(f.page ?? 1, 1);
  const q = f.q?.trim();
  const status = f.status === "ALL" ? undefined : f.status === "LEFT" ? { in: ["RETIRED", "RESIGNED", "TRANSFERRED", "TERMINATED", "DECEASED"] } : f.status ? f.status : { in: ["ACTIVE", "SUSPENDED"] };
  const where: Prisma.EmployeeWhereInput = {
    boardId: actor.boardId,
    ...(scope === "section" ? { sectionId: actor.sectionId ?? "__none__" } : f.sectionId ? { sectionId: f.sectionId } : {}),
    ...(f.type ? { type: f.type as Employee["type"] } : {}),
    ...(f.payLevel ? { payLevel: f.payLevel } : {}),
    ...(status ? { status: status as Prisma.EnumEmployeeStatusFilter } : {}),
    ...(q
      ? {
          OR: [
            { employeeCode: { contains: q.toUpperCase() } },
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { nameHi: { contains: q } },
            { mobile: { contains: q } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.employee.findMany({
      where,
      include: viewInclude,
      orderBy: [{ status: "asc" }, { employeeCode: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.employee.count({ where }),
  ]);
  return { rows: rows.map((e) => toView(e, actor)), total, page, pageSize };
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Date of retirement for a record: posts in the matrix retire at the post's age; contract staff have none. */
export function computeRetirement(type: string, dateOfBirth: string, retirementAge: number): string | null {
  return isMatrixType(type) ? retirementDate(dateOfBirth, retirementAge) : null;
}

async function namesFor(boardId: string, tx: Tx | typeof db = db) {
  const [sections, posts] = await Promise.all([
    tx.section.findMany({ where: { boardId }, select: { id: true, name: true } }),
    tx.post.findMany({ where: { boardId }, select: { id: true, name: true } }),
  ]);
  return { sections: new Map(sections.map((s) => [s.id, s.name])), posts: new Map(posts.map((p) => [p.id, p.name])) };
}

/** Throws a field-level conflict when another current employee already has this PAN / Aadhaar / bank account. */
export async function assertNoDuplicates(
  boardId: string,
  hashes: Partial<Record<SensitiveField, string>>,
  exceptEmployeeId?: string,
  tx: Tx | typeof db = db,
  prefix = "ids.",
) {
  const column = { pan: "panHash", aadhaar: "aadhaarHash", bankAccount: "bankAccountHash" } as const;
  const fields: Record<string, string> = {};
  for (const [field, hash] of Object.entries(hashes) as [SensitiveField, string][]) {
    if (!hash) continue;
    const other = await tx.employee.findFirst({
      where: { boardId, [column[field]]: hash, status: { in: [...ACTIVE_STATUSES] }, ...(exceptEmployeeId ? { NOT: { id: exceptEmployeeId } } : {}) },
      select: { id: true },
    });
    if (other) fields[`${prefix}${field}`] = "employees.errors.duplicateId";
  }
  if (Object.keys(fields).length) throw conflict("employees.errors.duplicateId", undefined, fields);
}

/** Turns the database's last-line duplicate guard into the same friendly message. */
export async function duplicateGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw conflict("employees.errors.duplicateId");
    throw e;
  }
}

function sealIds(ids: Partial<IdsInput>) {
  const data: Record<string, unknown> = {};
  const hashes: Partial<Record<SensitiveField, string>> = {};
  for (const field of Object.keys(SENSITIVE) as SensitiveField[]) {
    const value = ids[field];
    if (!value) continue;
    const sealed = seal(SENSITIVE[field], value);
    const prefix = field === "bankAccount" ? "bankAccount" : field;
    data[`${prefix}Enc`] = sealed.enc;
    data[`${prefix}Hash`] = sealed.hash;
    data[`${prefix}Last4`] = sealed.last4;
    hashes[field] = sealed.hash;
  }
  return { data, hashes };
}

function personalData(p: PersonalInput) {
  return {
    firstName: p.firstName,
    middleName: p.middleName,
    lastName: p.lastName,
    nameHi: p.nameHi,
    gender: p.gender,
    dateOfBirth: p.dateOfBirth,
    fatherOrSpouseName: p.fatherOrSpouseName,
    category: p.category,
    maritalStatus: p.maritalStatus,
    bloodGroup: p.bloodGroup,
    isDisabled: p.isDisabled,
    mobile: p.mobile,
    email: p.email,
    presentAddress: p.presentAddress,
    permanentAddress: p.permanentAddress,
  };
}

/** A biometric ID belongs to one person, so device punches always land on the right record (AT-01). */
async function assertBiometricFree(boardId: string, biometricId: string | null | undefined, except?: string, prefix = "") {
  if (!biometricId) return;
  const other = await db.employee.findFirst({ where: { boardId, biometricId, ...(except ? { id: { not: except } } : {}) }, select: { id: true } });
  if (other) throw conflict("employees.errors.biometricTaken", undefined, { [`${prefix}biometricId`]: "employees.errors.biometricTaken" });
}

function jobData(j: JobInput) {
  const matrix = isMatrixType(j.type);
  const wage = isWageType(j.type);
  return {
    type: j.type,
    sectionId: j.sectionId,
    postId: j.postId,
    dateOfJoining: j.dateOfJoining,
    payLevel: matrix ? j.payLevel : null,
    payCell: matrix ? (j.payCell ?? null) : null,
    probationEndDate: j.probationEndDate,
    confirmationDate: j.confirmationDate,
    agencyName: wage ? j.agencyName : null,
    wageRate: wage ? (j.wageRate ?? null) : null,
    wageBasis: wage ? j.wageBasis : null,
    contractStart: wage ? j.contractStart : null,
    contractEnd: wage ? j.contractEnd : null,
    biometricId: j.biometricId ?? null,
  };
}

function idsPlainData(ids: Partial<IdsInput>) {
  return {
    pran: ids.pran ?? null,
    uan: ids.uan ?? null,
    esicNumber: ids.esicNumber ?? null,
    gpfNumber: ids.gpfNumber ?? null,
    ifsc: ids.ifsc ?? null,
    bankName: ids.bankName ?? null,
    bankBranch: ids.bankBranch ?? null,
  };
}

/** Converts ISO date strings in an update payload back to Date objects for Prisma. */
export function toDbData(data: Record<string, unknown>): Prisma.EmployeeUncheckedUpdateInput {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (["dateOfBirth", "dateOfJoining", "dateOfRetirement", "probationEndDate", "confirmationDate", "contractStart", "contractEnd", "exitDate"].includes(k)) {
      out[k] = v ? fromISODate(String(v)) : null;
    } else if (k === "presentAddress" || k === "permanentAddress") {
      // JSON columns need Prisma.DbNull to store SQL NULL.
      out[k] = v === null || v === undefined ? Prisma.DbNull : v;
    } else out[k] = v;
  }
  return out as Prisma.EmployeeUncheckedUpdateInput;
}

function fieldErrors(errors: Record<string, string>) {
  if (Object.keys(errors).length) throw badRequest("errors.validation", errors);
}

// ── create (draft → Checker → Employee ID) ──────────────────────────────────

/**
 * EM-01/EM-10/RO flow step 4: HR enters a new employee; it stays a draft (no Employee ID, not paid) until a
 * Checker approves it.
 */
export async function createEmployee(actor: Actor, raw: unknown, opts: { tx?: Tx; skipApproval?: boolean; employeeCode?: string | null } = {}) {
  assertHr(actor);
  const input: CreateEmployeeInput = createEmployeeSchema.parse(raw);
  fieldErrors(crossCheck(input.personal, input.job, input.ids));
  await assertBiometricFree(actor.boardId, input.job.biometricId, undefined, "job.");

  const work = async (tx: Tx) => {
    const post = await tx.post.findFirst({ where: { id: input.job.postId, boardId: actor.boardId } });
    const section = await tx.section.findFirst({ where: { id: input.job.sectionId, boardId: actor.boardId } });
    if (!post) fieldErrors({ "job.postId": "validation.invalid" });
    if (!section) fieldErrors({ "job.sectionId": "validation.invalid" });
    const { data: sealed, hashes } = sealIds(input.ids);
    await assertNoDuplicates(actor.boardId, hashes, undefined, tx);
    const retirement = computeRetirement(input.job.type, input.personal.dateOfBirth, post!.retirementAge);
    const data = toDbData({
      ...personalData(input.personal),
      ...jobData(input.job),
      ...idsPlainData(input.ids),
      ...sealed,
      dateOfRetirement: retirement,
    });
    const employee = await tx.employee.create({
      data: {
        ...(data as Prisma.EmployeeUncheckedCreateInput),
        boardId: actor.boardId,
        status: "DRAFT",
        employeeCode: opts.employeeCode ?? null,
        createdById: actor.userId,
      },
    });
    await audit(tx, actor, {
      action: "CREATE",
      entityType: "Employee",
      entityId: employee.id,
      summary: `New employee entered: ${fullName(employee)} (waiting for check)`,
      newValue: { name: fullName(employee), type: employee.type, section: section!.name, post: post!.name },
    });
    if (!opts.skipApproval) {
      const details: ApprovalDetails = {
        summary: "Check the new employee's details against the documents. Approving issues the Employee ID.",
        summaryHi: "दस्तावेज़ों से नए कर्मचारी का विवरण जाँचें। स्वीकृति पर कर्मचारी आईडी जारी होगी।",
        link: `/employees/${employee.id}`,
        rows: [
          { ...fieldLabel("name"), new: fullName(employee) },
          { ...fieldLabel("type"), new: displayValue("type", employee.type) },
          { ...fieldLabel("postId"), new: post!.name },
          { ...fieldLabel("sectionId"), new: section!.name },
          { ...fieldLabel("dateOfBirth"), new: displayValue("dateOfBirth", employee.dateOfBirth) },
          { ...fieldLabel("dateOfJoining"), new: displayValue("dateOfJoining", employee.dateOfJoining) },
          ...(employee.payLevel ? [{ ...fieldLabel("payLevel"), new: `Level ${employee.payLevel}, Cell ${employee.payCell} (₹${basicPay(employee.payLevel, employee.payCell)?.toLocaleString("en-IN")})` }] : []),
          ...(employee.wageRate ? [{ ...fieldLabel("wageRate"), new: `₹${Number(employee.wageRate).toLocaleString("en-IN")} ${employee.wageBasis === "DAILY" ? "per day" : "per month"}` }] : []),
          { ...fieldLabel("pan"), new: maskedIds(employee).pan, reveal: employee.panEnc ? ("pan" as const) : undefined },
          { ...fieldLabel("aadhaar"), new: maskedIds(employee).aadhaar },
          { ...fieldLabel("bankAccount"), new: employee.bankAccountLast4 ? `${maskedIds(employee).bankAccount} · ${employee.ifsc ?? ""}` : null, reveal: employee.bankAccountEnc ? ("bankAccount" as const) : undefined },
        ],
      };
      await submitForApproval(tx, actor, {
        kind: "employee.create",
        title: `New employee: ${fullName(employee)}`,
        titleHi: `नया कर्मचारी: ${employee.nameHi ?? fullName(employee)}`,
        details,
        payload: { employeeId: employee.id },
        entityType: "Employee",
        entityId: employee.id,
        subjectEmployeeId: employee.id,
        note: input.note,
      });
    }
    return employee;
  };
  return duplicateGuard(() => (opts.tx ? work(opts.tx) : db.$transaction(work)));
}

/**
 * Puts a draft employee on the rolls: allocates the Employee ID (unless one came from FoxPro), sets the
 * record ACTIVE and records it. Used by the Checker's approval of a new record, a bulk batch or a joining.
 */
export async function issueEmployeeId(tx: Tx, actor: Actor, employeeId: string) {
  const e = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const code = e.employeeCode ?? (await nextEmployeeCode(tx, e.boardId));
  const updated = await tx.employee.update({ where: { id: e.id }, data: { status: "ACTIVE", employeeCode: code } });
  await tx.employeeFieldHistory.create({
    data: { employeeId: e.id, field: "employeeCode", oldValue: null, newValue: code, approvedById: actor.userId, approvedBy: actor.name },
  });
  await audit(tx, actor, { action: "ISSUE_ID", entityType: "Employee", entityId: e.id, summary: `Employee ID ${code} issued to ${fullName(e)}` });
  return updated;
}

/** Allocates the next Employee ID inside the caller's transaction ("DCB" + running number). */
export async function nextEmployeeCode(tx: Tx, boardId: string) {
  const board = await tx.board.findUniqueOrThrow({ where: { id: boardId } });
  for (;;) {
    const seq = await tx.sequence.upsert({
      where: { boardId_name: { boardId, name: "employee" } },
      create: { boardId, name: "employee", next: 2 },
      update: { next: { increment: 1 } },
    });
    const code = `${board.code}${String(seq.next - 1).padStart(5, "0")}`;
    // Codes brought over from FoxPro may already use a number — skip it.
    const taken = await tx.employee.findFirst({ where: { boardId, employeeCode: code }, select: { id: true } });
    if (!taken) return code;
  }
}

// ── edit (HR proposes → Checker approves, EM-07) ────────────────────────────

export type EditTab = "personal" | "job" | "ids";

interface Change {
  field: string;
  old: string | null;
  new: string | null;
  sensitive: boolean;
}

/**
 * HR proposes a change to one tab of a record. Nothing changes until a Checker approves it; old values are
 * kept in the history. A draft (not yet approved) record is simply corrected in place.
 */
export async function proposeEdit(actor: Actor, employeeId: string, tab: EditTab, raw: Record<string, unknown>) {
  assertHr(actor);
  const current = await db.employee.findFirst({ where: { id: employeeId, boardId: actor.boardId }, include: viewInclude });
  if (!current) throw notFound();
  if (current.id === actor.employeeId) throw forbidden("errors.ownPay");
  if (!["DRAFT", "ACTIVE", "SUSPENDED"].includes(current.status)) throw badRequest("employees.errors.notCurrent");
  const pending = await pendingFor(actor.boardId, "Employee", employeeId, ["employee.update"]);
  if (pending.length && current.status !== "DRAFT") throw conflict("employees.errors.pendingChange");

  const names = await namesFor(actor.boardId);
  const data: Record<string, unknown> = {};
  const changes: Change[] = [];
  const note = typeof raw.note === "string" ? raw.note.trim().slice(0, 500) || null : null;

  const compare = (field: string, before: unknown, after: unknown) => {
    const norm = (v: unknown) => (v instanceof Date ? toISODate(v) : v && typeof v === "object" && "toNumber" in v ? Number(v) : v ?? null);
    if (JSON.stringify(norm(before)) === JSON.stringify(norm(after))) return;
    data[field] = after;
    changes.push({ field, old: displayValue(field, norm(before), names), new: displayValue(field, after, names), sensitive: false });
  };

  const currentPersonal = { dateOfBirth: toISODate(current.dateOfBirth) };
  const currentJob: JobInput = {
    type: current.type,
    sectionId: current.sectionId,
    postId: current.postId,
    dateOfJoining: toISODate(current.dateOfJoining),
    payLevel: current.payLevel,
    payCell: current.payCell,
    probationEndDate: iso(current.probationEndDate),
    confirmationDate: iso(current.confirmationDate),
    agencyName: current.agencyName,
    wageRate: current.wageRate ? Number(current.wageRate) : null,
    wageBasis: current.wageBasis as JobInput["wageBasis"],
    contractStart: iso(current.contractStart),
    contractEnd: iso(current.contractEnd),
    biometricId: current.biometricId,
  };
  let hashes: Partial<Record<SensitiveField, string>> = {};

  if (tab === "personal") {
    const p = personalSchema.parse(raw);
    fieldErrors(tabErrors(crossCheck(p, currentJob), "personal"));
    for (const [field, value] of Object.entries(personalData(p))) compare(field, current[field as keyof Employee], value);
    if (p.dateOfBirth !== currentPersonal.dateOfBirth) {
      compare("dateOfRetirement", current.dateOfRetirement, computeRetirement(current.type, p.dateOfBirth, current.post.retirementAge));
    }
  } else if (tab === "job") {
    const j = jobSchema.parse(raw);
    fieldErrors(tabErrors(crossCheck(currentPersonal, j), "job"));
    const post = await db.post.findFirst({ where: { id: j.postId, boardId: actor.boardId } });
    if (!post) fieldErrors({ postId: "validation.invalid" });
    if (!(await db.section.findFirst({ where: { id: j.sectionId, boardId: actor.boardId } }))) fieldErrors({ sectionId: "validation.invalid" });
    await assertBiometricFree(actor.boardId, j.biometricId, employeeId);
    for (const [field, value] of Object.entries(jobData(j))) compare(field, current[field as keyof Employee], value);
    compare("dateOfRetirement", current.dateOfRetirement, computeRetirement(j.type, currentPersonal.dateOfBirth, post!.retirementAge));
  } else {
    const ids = idsSchema.parse(raw);
    if (ids.bankAccount && !ids.ifsc) fieldErrors({ ifsc: "validation.required" });
    for (const [field, value] of Object.entries(idsPlainData(ids))) compare(field, current[field as keyof Employee], value);
    // Sensitive numbers: an empty box means "keep what is there".
    const sealed = sealIds(ids);
    hashes = sealed.hashes;
    for (const field of Object.keys(SENSITIVE) as SensitiveField[]) {
      if (!ids[field]) continue;
      const hashCol = `${field}Hash` as keyof Employee;
      if (current[hashCol] === sealed.data[`${field}Hash`]) continue;
      for (const suffix of ["Enc", "Hash", "Last4"]) data[`${field}${suffix}`] = sealed.data[`${field}${suffix}`];
      const before = maskedIds(current)[field];
      const after = maskedIds({
        panLast4: field === "pan" ? String(sealed.data.panLast4) : null,
        aadhaarLast4: field === "aadhaar" ? String(sealed.data.aadhaarLast4) : null,
        bankAccountLast4: field === "bankAccount" ? String(sealed.data.bankAccountLast4) : null,
      })[field];
      changes.push({ field, old: before, new: after, sensitive: true });
    }
    await assertNoDuplicates(actor.boardId, hashes, employeeId, db, "");
  }

  if (!changes.length) throw badRequest("employees.errors.noChanges");

  if (current.status === "DRAFT") {
    // Drafts are corrected directly; the Checker sees the final values when approving the record.
    await duplicateGuard(() =>
      db.$transaction(async (tx) => {
        await tx.employee.update({ where: { id: employeeId }, data: toDbData(data) });
        await audit(tx, actor, {
          action: "UPDATE",
          entityType: "Employee",
          entityId: employeeId,
          summary: `Corrected draft record of ${fullName(current)}`,
          oldValue: Object.fromEntries(changes.map((c) => [c.field, c.old])),
          newValue: Object.fromEntries(changes.map((c) => [c.field, c.new])),
          sensitive: changes.some((c) => c.sensitive),
        });
      }),
    );
    return { applied: true, taskId: null };
  }

  const task = await db.$transaction((tx) =>
    submitForApproval(tx, actor, {
      kind: "employee.update",
      title: `Change to ${fullName(current)} (${current.employeeCode})`,
      titleHi: `${current.nameHi ?? fullName(current)} (${current.employeeCode}) के रिकॉर्ड में बदलाव`,
      details: {
        summary: "Check the change against the order or document before approving. Old values are kept in the history.",
        summaryHi: "स्वीकृति से पहले आदेश या दस्तावेज़ से बदलाव जाँचें। पुराने मान इतिहास में रहते हैं।",
        link: `/employees/${employeeId}`,
        rows: changes.map((c) => ({ ...fieldLabel(c.field), old: c.old, new: c.new, reveal: c.field === "pan" || c.field === "bankAccount" ? (c.field as "pan" | "bankAccount") : undefined })),
      } satisfies ApprovalDetails,
      payload: { employeeId, data, history: changes, baseUpdatedAt: current.updatedAt.toISOString() },
      entityType: "Employee",
      entityId: employeeId,
      subjectEmployeeId: employeeId,
      sectionId: current.sectionId,
      note,
    }),
  );
  return { applied: false, taskId: task.id };
}

/** Cross-field errors use "job.x" keys; a single-tab edit form uses plain field names. */
function tabErrors(errors: Record<string, string>, tab: EditTab) {
  return Object.fromEntries(
    Object.entries(errors).map(([k, v]) => {
      const plain = k.replace(/^(personal|job|ids)\./, "");
      // "Too young at joining" belongs to the date of birth when the personal tab is being edited.
      return [tab === "personal" && plain === "dateOfJoining" ? "dateOfBirth" : plain, v];
    }),
  );
}

/** Applies an approved change (called by the approval handler, inside the decision transaction). */
export async function applyEmployeeChange(
  tx: Tx,
  actor: Actor,
  task: { id: string; makerId: string; makerName: string },
  employeeId: string,
  data: Record<string, unknown>,
  history: Change[],
) {
  const before = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
  // Re-check duplicates at the moment of approval — someone else may have been given the same number meanwhile.
  const hashes: Partial<Record<SensitiveField, string>> = {};
  if (data.panHash) hashes.pan = String(data.panHash);
  if (data.aadhaarHash) hashes.aadhaar = String(data.aadhaarHash);
  if (data.bankAccountHash) hashes.bankAccount = String(data.bankAccountHash);
  await assertNoDuplicates(before.boardId, hashes, employeeId, tx);
  const dbData = toDbData(data);
  const after = await duplicateGuard(() => tx.employee.update({ where: { id: employeeId }, data: dbData }));
  // A corrected level, cell or post is pay history from the 1st of this month, so it is not overtaken by an older row.
  if (after.payLevel && after.payCell && (after.payLevel !== before.payLevel || after.payCell !== before.payCell || after.postId !== before.postId)) {
    await tx.payHistory.create({
      data: { boardId: before.boardId, employeeId, effectiveFrom: fromISODate(`${todayIST().slice(0, 7)}-01`), payLevel: after.payLevel, payCell: after.payCell, postId: after.postId, reason: "CORRECTION", applied: true, createdById: task.makerId },
    });
  }
  if (history.length) {
    await tx.employeeFieldHistory.createMany({
      data: history.map((h) => ({
        employeeId,
        field: h.field,
        oldValue: h.old,
        newValue: h.new,
        isSensitive: h.sensitive,
        changedById: task.makerId,
        changedBy: task.makerName,
        approvedById: actor.userId,
        approvedBy: actor.name,
        taskId: task.id,
      })),
    });
  }
  await audit(tx, actor, {
    action: "UPDATE",
    entityType: "Employee",
    entityId: employeeId,
    summary: `Applied approved change to ${fullName(before)}: ${history.map((h) => h.field).join(", ")}`,
    oldValue: Object.fromEntries(history.map((h) => [h.field, h.old])),
    newValue: Object.fromEntries(history.map((h) => [h.field, h.new])),
    sensitive: history.some((h) => h.sensitive || ["payLevel", "payCell", "wageRate"].includes(h.field)),
  });
  // If the person moved section, logins follow automatically (scope is read from the record — PRD §2 rule 5).
}

export async function fieldHistory(actor: Actor, employeeId: string) {
  const e = await db.employee.findFirst({ where: { id: employeeId, boardId: actor.boardId }, select: { id: true, sectionId: true } });
  if (!e || !canViewEmployee(actor, e)) throw notFound();
  const showSensitive = canSeeSensitive(actor);
  const rows = await db.employeeFieldHistory.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" }, take: 200 });
  return rows.filter((r) => showSensitive || !r.isSensitive);
}

/** Pending change on a record, for the "waiting for check" banner. */
export async function pendingChanges(actor: Actor, employeeId: string) {
  const tasks = await pendingFor(actor.boardId, "Employee", employeeId);
  return tasks.map((t) => ({
    id: t.id,
    kind: t.kind,
    title: t.title,
    titleHi: t.titleHi,
    makerName: t.makerName,
    makerId: t.makerId,
    createdAt: t.createdAt.toISOString(),
    requiredPermission: t.requiredPermission,
    rows: ((t.details as ApprovalDetails | null)?.rows ?? []).slice(0, 12),
  }));
}

// ── sensitive numbers ───────────────────────────────────────────────────────

/** Full PAN or bank account for checking against a document; every look is recorded. Aadhaar stays masked. */
export async function revealIdentifier(actor: Actor, employeeId: string, field: "pan" | "bankAccount") {
  const e = await db.employee.findFirst({ where: { id: employeeId, boardId: actor.boardId } });
  if (!e) throw notFound();
  const own = actor.employeeId === e.id;
  if (!own && !canRevealIds(actor)) throw forbidden();
  const token = field === "pan" ? e.panEnc : e.bankAccountEnc;
  if (!token) throw notFound();
  await audit(db, actor, {
    action: "VIEW_SENSITIVE",
    entityType: "Employee",
    entityId: e.id,
    summary: `Viewed full ${field === "pan" ? "PAN" : "bank account"} of ${fullName(e)}`,
    sensitive: true,
  });
  return decrypt(token);
}

/** The proposed new PAN / bank number inside a pending change, for the person deciding it. */
export async function revealProposed(actor: Actor, taskId: string, field: "pan" | "bankAccount") {
  const task = await db.approvalTask.findFirst({ where: { id: taskId, boardId: actor.boardId } });
  if (!task || !canRevealIds(actor) || !actor.permissions.includes(task.requiredPermission)) throw forbidden();
  const data = (task.payload as { data?: Record<string, unknown> }).data ?? {};
  let token = data[`${field}Enc`] as string | undefined;
  if (!token && task.kind === "employee.create") {
    const e = await db.employee.findUnique({ where: { id: task.entityId ?? "" } });
    token = (field === "pan" ? e?.panEnc : e?.bankAccountEnc) ?? undefined;
  }
  if (!token) throw notFound();
  await audit(db, actor, {
    action: "VIEW_SENSITIVE",
    entityType: task.entityType,
    entityId: task.entityId,
    summary: `Viewed proposed ${field === "pan" ? "PAN" : "bank account"} while checking "${task.title}"`,
    sensitive: true,
  });
  return decrypt(token);
}

export { addressLine };
