import "server-only";
import ExcelJS from "exceljs";
import type { Prisma } from "@/generated/prisma/client";
import { pendingFor, submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import { canAll, scopeFor } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db, type Tx } from "@/lib/db";
import { addDays, addYears, formatDate, fromISODate, todayIST, toISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { basicPay } from "@/modules/payroll/matrix-7cpc";
import { vacantCount } from "@/modules/employees/records";
import { fieldLabel, fullName, maskedIds } from "@/modules/employees/present";
import { createEmployee } from "@/modules/employees/service";
import { parseSheetDate } from "@/modules/employees/bulk";
import {
  advertSchema,
  applicantSchema,
  applicantUpdateSchema,
  checklistUpdateSchema,
  CHECKLIST_ITEMS,
  directJoiningSchema,
  emptyChecklist,
  RESERVATION_CATEGORIES,
  vacancySchema,
  type Checklist,
} from "./schema";

const OPEN_VACANCY = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ADVERTISED"] as const;

function assertCreate(actor: Actor) {
  if (!canAll(actor, "recruitment", "create")) throw forbidden();
}
function assertView(actor: Actor) {
  if (!scopeFor(actor, "recruitment", "view")) throw forbidden();
}

async function nextNumber(tx: Tx, boardId: string, name: string) {
  const seq = await tx.sequence.upsert({
    where: { boardId_name: { boardId, name } },
    create: { boardId, name, next: 2 },
    update: { next: { increment: 1 } },
  });
  return seq.next - 1;
}

// ── vacancies (RO-01, RO-02, S-20) ──────────────────────────────────────────

/**
 * Seats that can still be advertised for a section + post: vacant sanctioned posts minus the seats already
 * held by other open vacancies (people already joining from those vacancies count once, as filled).
 */
export async function availableSeats(boardId: string, sectionId: string, postId: string, exceptVacancyId?: string) {
  const vacant = await vacantCount(boardId, sectionId, postId);
  const open = await db.vacancy.findMany({
    where: { boardId, sectionId, postId, status: { in: [...OPEN_VACANCY] }, ...(exceptVacancyId ? { NOT: { id: exceptVacancyId } } : {}) },
    include: { _count: { select: { joinings: { where: { status: { not: "CANCELLED" } } } } } },
  });
  const held = open.reduce((a, v) => a + Math.max(0, v.seats - v._count.joinings), 0);
  return Math.max(0, vacant - held);
}

export async function listVacancies(actor: Actor) {
  assertView(actor);
  return db.vacancy.findMany({
    where: { boardId: actor.boardId },
    orderBy: [{ createdAt: "desc" }],
    include: {
      _count: { select: { applicants: true, joinings: { where: { status: { not: "CANCELLED" } } } } },
    },
    take: 200,
  });
}

export async function getVacancy(actor: Actor, id: string) {
  assertView(actor);
  const v = await db.vacancy.findFirst({
    where: { id, boardId: actor.boardId },
    include: {
      applicants: { orderBy: [{ meritRank: "asc" }, { applicationNo: "asc" }], include: { joining: true } },
      joinings: true,
    },
  });
  if (!v) throw notFound();
  return v;
}

function vacancyDetails(v: { seats: number; reservation: unknown; advertNumber: string | null; lastDate: Date | null; payLevel: string }, section: string, post: string): ApprovalDetails {
  const r = v.reservation as Record<string, number>;
  return {
    link: undefined,
    rows: [
      { label: "Post", labelHi: "पद", new: `${post} — Level ${v.payLevel} (₹${basicPay(v.payLevel, 1)?.toLocaleString("en-IN")})` },
      { label: "Section", labelHi: "अनुभाग", new: section },
      { label: "Seats", labelHi: "सीटें", new: String(v.seats) },
      { label: "Reservation", labelHi: "आरक्षण", new: RESERVATION_CATEGORIES.filter((c) => r[c]).map((c) => `${c} ${r[c]}`).join(" · ") },
      ...(v.advertNumber ? [{ label: "Advertisement", labelHi: "विज्ञापन", new: v.advertNumber }] : []),
      ...(v.lastDate ? [{ label: "Last date", labelHi: "अंतिम तिथि", new: formatDate(toISODate(v.lastDate)) }] : []),
    ],
  };
}

/** HR creates a vacancy against a vacant sanctioned post; it goes straight to an Admin for approval (RO-01). */
export async function createVacancy(actor: Actor, raw: unknown) {
  assertCreate(actor);
  const input = vacancySchema.parse(raw);
  const [section, post] = await Promise.all([
    db.section.findFirst({ where: { id: input.sectionId, boardId: actor.boardId } }),
    db.post.findFirst({ where: { id: input.postId, boardId: actor.boardId } }),
  ]);
  if (!section) throw badRequest("errors.validation", { sectionId: "validation.invalid" });
  if (!post) throw badRequest("errors.validation", { postId: "validation.invalid" });
  const available = await availableSeats(actor.boardId, section.id, post.id);
  if (input.seats > available) throw badRequest("recruitment.errors.noVacantPost", { seats: "recruitment.errors.noVacantPost" }, { available });

  return db.$transaction(async (tx) => {
    const year = todayIST().slice(0, 4);
    const n = await nextNumber(tx, actor.boardId, `vacancy-${year}`);
    const vacancy = await tx.vacancy.create({
      data: {
        boardId: actor.boardId,
        referenceNo: `DCB/REC/${year}/${String(n).padStart(3, "0")}`,
        sectionId: section.id,
        postId: post.id,
        payLevel: post.payLevel,
        seats: input.seats,
        reservation: input.reservation as Prisma.InputJsonValue,
        advertNumber: input.advertNumber,
        advertDate: input.advertDate ? fromISODate(input.advertDate) : null,
        lastDate: input.lastDate ? fromISODate(input.lastDate) : null,
        notes: input.notes,
        status: "PENDING_APPROVAL",
        createdById: actor.userId,
      },
    });
    await submitForApproval(tx, actor, {
      kind: "vacancy.approve",
      title: `Vacancy ${vacancy.referenceNo}: ${input.seats} × ${post.name}`,
      titleHi: `रिक्ति ${vacancy.referenceNo}: ${input.seats} × ${post.nameHi}`,
      details: { ...vacancyDetails(vacancy, section.name, post.name), link: `/recruitment/vacancies/${vacancy.id}`, summary: `Vacant sanctioned posts available: ${available}.` },
      payload: { vacancyId: vacancy.id },
      entityType: "Vacancy",
      entityId: vacancy.id,
      note: input.notes,
    });
    await audit(tx, actor, { action: "CREATE", entityType: "Vacancy", entityId: vacancy.id, summary: `Created vacancy ${vacancy.referenceNo} for ${input.seats} × ${post.name}` });
    return vacancy;
  });
}

/** After an Admin's approval the vacancy is advertised (RO-02: advertisement number and date, last date). */
export async function markAdvertised(actor: Actor, id: string, raw: unknown) {
  assertCreate(actor);
  const input = advertSchema.parse(raw);
  const v = await db.vacancy.findFirst({ where: { id, boardId: actor.boardId } });
  if (!v) throw notFound();
  if (v.status !== "APPROVED" && v.status !== "ADVERTISED") throw badRequest("recruitment.errors.notApproved");
  return db.$transaction(async (tx) => {
    const updated = await tx.vacancy.update({
      where: { id },
      data: { status: "ADVERTISED", advertNumber: input.advertNumber, advertDate: fromISODate(input.advertDate), lastDate: fromISODate(input.lastDate) },
    });
    await audit(tx, actor, { action: "UPDATE", entityType: "Vacancy", entityId: id, summary: `Vacancy ${v.referenceNo} advertised (${input.advertNumber})`, newValue: input });
    return updated;
  });
}

export async function closeVacancy(actor: Actor, id: string, cancel = false) {
  assertCreate(actor);
  const v = await db.vacancy.findFirst({ where: { id, boardId: actor.boardId }, include: { joinings: { where: { status: { in: ["IN_PROGRESS", "SUBMITTED"] } } } } });
  if (!v) throw notFound();
  if (!OPEN_VACANCY.includes(v.status as (typeof OPEN_VACANCY)[number])) throw badRequest("recruitment.errors.notOpen");
  if (v.joinings.length) throw badRequest("recruitment.errors.joiningsOpen");
  if ((await pendingFor(actor.boardId, "Vacancy", id)).length) throw conflict("employees.errors.pendingChange");
  await db.$transaction(async (tx) => {
    await tx.vacancy.update({ where: { id }, data: { status: cancel ? "CANCELLED" : "CLOSED" } });
    await audit(tx, actor, { action: cancel ? "CANCEL" : "CLOSE", entityType: "Vacancy", entityId: id, summary: `${cancel ? "Cancelled" : "Closed"} vacancy ${v.referenceNo}` });
  });
}

// ── applicants and selection (RO-03, RO-04, S-21) ───────────────────────────

async function openVacancyForApplicants(actor: Actor, vacancyId: string) {
  const v = await db.vacancy.findFirst({ where: { id: vacancyId, boardId: actor.boardId } });
  if (!v) throw notFound();
  if (v.status !== "ADVERTISED" && v.status !== "APPROVED") throw badRequest("recruitment.errors.notAdvertised");
  if (v.selectionStatus !== "OPEN") throw badRequest("recruitment.errors.selectionLocked");
  return v;
}

export async function addApplicant(actor: Actor, vacancyId: string, raw: unknown, tx?: Tx) {
  assertCreate(actor);
  const input = applicantSchema.parse(raw);
  const v = await openVacancyForApplicants(actor, vacancyId);
  const work = async (t: Tx) => {
    let applicationNo = input.applicationNo?.toUpperCase();
    if (!applicationNo) applicationNo = `A-${String(await nextNumber(t, actor.boardId, `applicant-${v.id}`)).padStart(4, "0")}`;
    const exists = await t.applicant.findUnique({ where: { vacancyId_applicationNo: { vacancyId, applicationNo } } });
    if (exists) throw conflict("errors.duplicate", { field: "application number" }, { applicationNo: "errors.duplicate" });
    const a = await t.applicant.create({
      data: {
        vacancyId,
        applicationNo,
        name: input.name,
        nameHi: input.nameHi,
        fatherName: input.fatherName,
        gender: input.gender,
        dateOfBirth: fromISODate(input.dateOfBirth),
        category: input.category,
        mobile: input.mobile,
        email: input.email,
        address: input.address,
        qualification: input.qualification,
      },
    });
    await audit(t, actor, { action: "CREATE", entityType: "Applicant", entityId: a.id, summary: `Added applicant ${a.applicationNo} ${a.name} to ${v.referenceNo}` });
    return a;
  };
  return tx ? work(tx) : db.$transaction(work);
}

export async function updateApplicant(actor: Actor, applicantId: string, raw: unknown) {
  assertCreate(actor);
  const input = applicantUpdateSchema.parse(raw);
  const a = await db.applicant.findFirst({ where: { id: applicantId, vacancy: { boardId: actor.boardId } }, include: { vacancy: true } });
  if (!a) throw notFound();
  if (a.vacancy.selectionStatus !== "OPEN") throw badRequest("recruitment.errors.selectionLocked");
  return db.$transaction(async (tx) => {
    const updated = await tx.applicant.update({
      where: { id: applicantId },
      data: { status: input.status, score: input.score ?? null, meritRank: input.meritRank ?? null, remarks: input.remarks },
    });
    await audit(tx, actor, {
      action: "UPDATE",
      entityType: "Applicant",
      entityId: applicantId,
      summary: `Applicant ${a.applicationNo} ${a.name}: ${a.status} → ${input.status}`,
      oldValue: { status: a.status, score: a.score?.toString() ?? null, meritRank: a.meritRank },
      newValue: { status: input.status, score: input.score ?? null, meritRank: input.meritRank ?? null },
    });
    return updated;
  });
}

const APPLICANT_COLUMNS = [
  ["applicationNo", "Application no."],
  ["name", "Name *"],
  ["nameHi", "Name in Hindi"],
  ["fatherName", "Father's name"],
  ["gender", "Gender (M/F/T) *"],
  ["dateOfBirth", "Date of birth (DD-MM-YYYY) *"],
  ["category", "Category (GEN/OBC/SC/ST/EWS) *"],
  ["mobile", "Mobile"],
  ["email", "Email"],
  ["qualification", "Qualification"],
  ["address", "Address"],
] as const;

export async function applicantTemplate(actor: Actor) {
  assertCreate(actor);
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Applicants", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = APPLICANT_COLUMNS.map(([key, header]) => ({ key, header, width: Math.max(14, header.length + 2) }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF116541" } };
  APPLICANT_COLUMNS.forEach((_, i) => (sheet.getColumn(i + 1).numFmt = "@"));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** RO-03 Excel import — every row checked; nothing saved unless all rows are fine. */
export async function importApplicants(actor: Actor, vacancyId: string, buffer: Buffer) {
  assertCreate(actor);
  await openVacancyForApplicants(actor, vacancyId);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw badRequest("employees.errors.notExcel");
  }
  const sheet = wb.worksheets[0];
  const rows: { row: number; data: Record<string, string>; errors: string[] }[] = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const data: Record<string, string> = {};
    APPLICANT_COLUMNS.forEach(([key], i) => {
      const v = row.getCell(i + 1).value;
      data[key] = v instanceof Date ? toISODate(v) : v === null || v === undefined ? "" : typeof v === "object" && "text" in v ? String(v.text) : String(v).trim();
    });
    if (!Object.values(data).some(Boolean)) return;
    const dob = parseSheetDate(data.dateOfBirth);
    const parsed = applicantSchema.safeParse({ ...data, gender: data.gender.toUpperCase(), category: data.category.toUpperCase(), dateOfBirth: dob === "invalid" ? "" : dob ?? "" });
    rows.push({ row: n, data, errors: parsed.success ? [] : parsed.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`) });
  });
  const bad = rows.filter((r) => r.errors.length);
  if (bad.length) return { imported: 0, errors: bad.map((r) => ({ row: r.row, errors: r.errors })) };
  await db.$transaction(
    async (tx) => {
      for (const r of rows) {
        const dob = parseSheetDate(r.data.dateOfBirth);
        await addApplicant(actor, vacancyId, { ...r.data, gender: r.data.gender.toUpperCase(), category: r.data.category.toUpperCase(), dateOfBirth: dob }, tx);
      }
    },
    { timeout: 120_000 },
  );
  return { imported: rows.length, errors: [] };
}

/**
 * RO-04: the selection list goes to an Admin. Rules checked first: at least one selected, not more than the
 * seats, and general-category candidates only on unreserved seats (reserved-category candidates may also
 * take unreserved seats on merit).
 */
export async function submitSelection(actor: Actor, vacancyId: string) {
  assertCreate(actor);
  const v = await db.vacancy.findFirst({ where: { id: vacancyId, boardId: actor.boardId }, include: { applicants: true, } });
  if (!v) throw notFound();
  if (v.selectionStatus !== "OPEN") throw badRequest("recruitment.errors.selectionLocked");
  const selected = v.applicants.filter((a) => a.status === "SELECTED");
  const waitlisted = v.applicants.filter((a) => a.status === "WAITLISTED");
  if (!selected.length) throw badRequest("recruitment.errors.noneSelected");
  if (selected.length > v.seats) throw badRequest("recruitment.errors.tooManySelected", undefined, { seats: v.seats });
  const reservation = v.reservation as Record<string, number>;
  const gen = selected.filter((a) => a.category === "GEN").length;
  if (gen > (reservation.GEN ?? 0)) throw badRequest("recruitment.errors.genOverReserved", undefined, { seats: reservation.GEN ?? 0 });
  const post = await db.post.findUniqueOrThrow({ where: { id: v.postId } });
  return db.$transaction(async (tx) => {
    await tx.vacancy.update({ where: { id: vacancyId }, data: { selectionStatus: "PENDING_APPROVAL" } });
    return submitForApproval(tx, actor, {
      kind: "selection.approve",
      title: `Selection list ${v.referenceNo}: ${selected.length} × ${post.name}`,
      titleHi: `चयन सूची ${v.referenceNo}: ${selected.length} × ${post.nameHi}`,
      details: {
        link: `/recruitment/vacancies/${vacancyId}`,
        summary: `${selected.length} selected for ${v.seats} seats, ${waitlisted.length} on the wait list.`,
        summaryHi: `${v.seats} सीटों के लिए ${selected.length} चयनित, ${waitlisted.length} प्रतीक्षा सूची में।`,
        rows: [...selected, ...waitlisted]
          .sort((a, b) => (a.meritRank ?? 9999) - (b.meritRank ?? 9999))
          .map((a) => ({ label: `${a.status === "SELECTED" ? "Selected" : "Wait list"}${a.meritRank ? ` · rank ${a.meritRank}` : ""}`, labelHi: a.status === "SELECTED" ? "चयनित" : "प्रतीक्षा सूची", new: `${a.applicationNo} ${a.name} (${a.category})` })),
      } satisfies ApprovalDetails,
      payload: { vacancyId },
      entityType: "Vacancy",
      entityId: vacancyId,
    });
  });
}

/** Appointment letter number for a selected candidate (RO-04). The letter itself is printed in Hindi and English. */
export async function issueAppointmentLetter(actor: Actor, applicantId: string) {
  assertCreate(actor);
  const a = await db.applicant.findFirst({ where: { id: applicantId, vacancy: { boardId: actor.boardId } }, include: { vacancy: true } });
  if (!a) throw notFound();
  if (a.vacancy.selectionStatus !== "APPROVED" || a.status !== "SELECTED") throw badRequest("recruitment.errors.notSelected");
  if (a.appointmentLetterNo) return a;
  return db.$transaction(async (tx) => {
    const n = await nextNumber(tx, actor.boardId, `letter-${a.vacancyId}`);
    const updated = await tx.applicant.update({
      where: { id: applicantId },
      data: { appointmentLetterNo: `${a.vacancy.referenceNo}/APT/${String(n).padStart(2, "0")}`, appointmentLetterDate: fromISODate(todayIST()) },
    });
    await audit(tx, actor, { action: "ISSUE", entityType: "Applicant", entityId: applicantId, summary: `Appointment letter ${updated.appointmentLetterNo} issued to ${a.name}` });
    return updated;
  });
}

// ── joining (RO-05, RO-06, RO-09, S-22) ─────────────────────────────────────

function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

/** The candidate reports for duty: a draft employee record is opened and the joining checklist starts. */
export async function startJoining(actor: Actor, applicantId: string, dateOfJoining?: string) {
  assertCreate(actor);
  const a = await db.applicant.findFirst({ where: { id: applicantId, vacancy: { boardId: actor.boardId } }, include: { vacancy: true, joining: true } });
  if (!a) throw notFound();
  if (!a.appointmentLetterNo) throw badRequest("recruitment.errors.letterFirst");
  if (a.joining && a.joining.status !== "CANCELLED") return a.joining;
  const doj = dateOfJoining ?? todayIST();
  // New permanent recruits after 1 Jan 2004 are in NPS; HR can still change the type on the draft record.
  const type = doj >= "2004-01-01" ? "PERMANENT_NPS" : "PERMANENT_OPS";
  return db.$transaction(async (tx) => {
    const employee = await createEmployee(
      actor,
      {
        personal: { ...splitName(a.name), nameHi: a.nameHi, gender: a.gender, dateOfBirth: toISODate(a.dateOfBirth), category: a.category, fatherOrSpouseName: a.fatherName, mobile: a.mobile, email: a.email, isDisabled: false },
        job: { type, sectionId: a.vacancy.sectionId, postId: a.vacancy.postId, dateOfJoining: doj, payLevel: a.vacancy.payLevel, payCell: 1, probationEndDate: addDays(addYears(doj, 2), -1) },
        ids: {},
      },
      { tx, skipApproval: true },
    );
    if (a.joining) await tx.joining.delete({ where: { id: a.joining.id } });
    const joining = await tx.joining.create({
      data: { boardId: actor.boardId, applicantId, vacancyId: a.vacancyId, employeeId: employee.id, checklist: emptyChecklist() as unknown as Prisma.InputJsonValue, createdById: actor.userId },
    });
    await audit(tx, actor, { action: "CREATE", entityType: "Joining", entityId: joining.id, summary: `Joining started for ${a.name} (${a.appointmentLetterNo})` });
    return joining;
  });
}

/** RO-09: contract and daily-wage workers are onboarded directly, without a vacancy. */
export async function startDirectJoining(actor: Actor, raw: unknown) {
  assertCreate(actor);
  const input = directJoiningSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const employee = await createEmployee(
      actor,
      {
        personal: { firstName: input.firstName, lastName: input.lastName, nameHi: input.nameHi, gender: input.gender, dateOfBirth: input.dateOfBirth, mobile: input.mobile, isDisabled: false },
        job: {
          type: input.type,
          sectionId: input.sectionId,
          postId: input.postId,
          dateOfJoining: input.dateOfJoining,
          agencyName: input.agencyName,
          wageRate: input.wageRate,
          wageBasis: input.wageBasis,
          contractStart: input.contractStart,
          contractEnd: input.contractEnd,
        },
        ids: {},
      },
      { tx, skipApproval: true },
    );
    const joining = await tx.joining.create({
      data: { boardId: actor.boardId, employeeId: employee.id, checklist: emptyChecklist() as unknown as Prisma.InputJsonValue, createdById: actor.userId },
    });
    await audit(tx, actor, { action: "CREATE", entityType: "Joining", entityId: joining.id, summary: `Direct joining started for ${fullName(employee)} (${input.type})` });
    return joining;
  });
}

export async function listJoinings(actor: Actor) {
  assertView(actor);
  const rows = await db.joining.findMany({
    where: { boardId: actor.boardId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { applicant: { select: { name: true, applicationNo: true, appointmentLetterNo: true } }, vacancy: { select: { referenceNo: true } } },
    take: 200,
  });
  const employees = await db.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId) } }, include: { post: true, section: true } });
  return rows.map((r) => ({ ...r, employee: employees.find((e) => e.id === r.employeeId)! }));
}

export async function getJoining(actor: Actor, id: string) {
  assertView(actor);
  const j = await db.joining.findFirst({ where: { id, boardId: actor.boardId }, include: { applicant: true, vacancy: true } });
  if (!j) throw notFound();
  const employee = await db.employee.findUniqueOrThrow({ where: { id: j.employeeId }, include: { post: true, section: true } });
  const documents = await db.employeeDocument.findMany({ where: { employeeId: j.employeeId, deletedAt: null } });
  return { ...j, checklist: j.checklist as unknown as Checklist, employee, documents };
}

export async function updateChecklist(actor: Actor, joiningId: string, raw: unknown) {
  assertCreate(actor);
  const input = checklistUpdateSchema.parse(raw);
  const j = await db.joining.findFirst({ where: { id: joiningId, boardId: actor.boardId } });
  if (!j) throw notFound();
  if (j.status !== "IN_PROGRESS") throw badRequest("recruitment.errors.joiningLocked");
  if (input.documentId && !(await db.employeeDocument.findFirst({ where: { id: input.documentId, employeeId: j.employeeId } }))) {
    throw badRequest("errors.validation", { documentId: "validation.invalid" });
  }
  const checklist = j.checklist as unknown as Checklist;
  checklist[input.item] = {
    done: input.done,
    documentId: input.documentId ?? checklist[input.item].documentId,
    note: input.note ?? checklist[input.item].note,
    by: input.done ? actor.name : null,
    at: input.done ? new Date().toISOString() : null,
  };
  await db.$transaction(async (tx) => {
    await tx.joining.update({ where: { id: joiningId }, data: { checklist: checklist as unknown as Prisma.InputJsonValue } });
    await audit(tx, actor, { action: "UPDATE", entityType: "Joining", entityId: joiningId, summary: `Joining checklist: ${input.item} ${input.done ? "done" : "not done"}` });
  });
  return checklist;
}

/**
 * RO-06 "Complete joining": every checklist item is ticked and the record holds PAN, Aadhaar and bank details;
 * the Checker then verifies documents and initial pay, and the approval issues the Employee ID.
 */
export async function completeJoining(actor: Actor, joiningId: string) {
  assertCreate(actor);
  const j = await getJoining(actor, joiningId);
  if (j.status !== "IN_PROGRESS") throw badRequest("recruitment.errors.joiningLocked");
  const missing = CHECKLIST_ITEMS.filter((k) => !j.checklist[k].done);
  if (missing.length) throw badRequest("recruitment.errors.checklistIncomplete", undefined, { items: missing.length });
  const e = j.employee;
  const needs: string[] = [];
  if (!e.panHash) needs.push("pan");
  if (!e.aadhaarHash) needs.push("aadhaar");
  if (!e.bankAccountHash || !e.ifsc) needs.push("bankAccount");
  if (needs.length) throw badRequest("recruitment.errors.idsMissing", Object.fromEntries(needs.map((f) => [f, "validation.required"])));
  return db.$transaction(async (tx) => {
    await tx.joining.update({ where: { id: joiningId }, data: { status: "SUBMITTED" } });
    const masked = maskedIds(e);
    return submitForApproval(tx, actor, {
      kind: "joining.complete",
      title: `Joining: ${fullName(e)} as ${e.post.name}`,
      titleHi: `कार्यग्रहण: ${e.nameHi ?? fullName(e)} — ${e.post.nameHi}`,
      details: {
        link: `/recruitment/joining/${joiningId}`,
        summary: "Verify the documents and the initial pay. Approving issues the Employee ID, adds the person to the next payroll from the date of joining and sends a login by SMS.",
        summaryHi: "दस्तावेज़ और प्रारंभिक वेतन जाँचें। स्वीकृति पर कर्मचारी आईडी जारी होगी, कार्यग्रहण तिथि से अगले वेतन में नाम जुड़ेगा और एसएमएस से लॉगिन जाएगा।",
        rows: [
          { ...fieldLabel("name"), new: fullName(e) },
          { ...fieldLabel("postId"), new: `${e.post.name} — ${e.section.name}` },
          { ...fieldLabel("dateOfJoining"), new: formatDate(toISODate(e.dateOfJoining)) },
          e.payLevel
            ? { label: "Initial pay", labelHi: "प्रारंभिक वेतन", new: `Level ${e.payLevel}, Cell ${e.payCell} — ₹${basicPay(e.payLevel, e.payCell)?.toLocaleString("en-IN")}` }
            : { label: "Wage", labelHi: "मज़दूरी", new: `₹${Number(e.wageRate).toLocaleString("en-IN")} ${e.wageBasis === "DAILY" ? "per day" : "per month"}` },
          ...(j.applicant?.appointmentLetterNo ? [{ label: "Appointment letter", labelHi: "नियुक्ति पत्र", new: j.applicant.appointmentLetterNo }] : []),
          { ...fieldLabel("pan"), new: masked.pan, reveal: "pan" as const },
          { ...fieldLabel("aadhaar"), new: masked.aadhaar },
          { ...fieldLabel("bankAccount"), new: `${masked.bankAccount} · ${e.ifsc}`, reveal: "bankAccount" as const },
          { label: "Checklist", labelHi: "जाँच सूची", new: `${CHECKLIST_ITEMS.length}/${CHECKLIST_ITEMS.length} done, ${j.documents.length} documents` },
        ],
      } satisfies ApprovalDetails,
      payload: { joiningId, employeeId: e.id },
      entityType: "Employee",
      entityId: e.id,
      subjectEmployeeId: e.id,
    });
  });
}

export async function cancelJoining(actor: Actor, joiningId: string) {
  assertCreate(actor);
  const j = await db.joining.findFirst({ where: { id: joiningId, boardId: actor.boardId } });
  if (!j) throw notFound();
  if (j.status !== "IN_PROGRESS") throw badRequest("recruitment.errors.joiningLocked");
  await db.$transaction(async (tx) => {
    await tx.joining.update({ where: { id: joiningId }, data: { status: "CANCELLED" } });
    await tx.employee.deleteMany({ where: { id: j.employeeId, status: "DRAFT" } });
    await audit(tx, actor, { action: "CANCEL", entityType: "Joining", entityId: joiningId, summary: "Joining cancelled; draft record removed" });
  });
}

// ── probation (RO-08) ───────────────────────────────────────────────────────

export async function probationList(actor: Actor) {
  if (!canAll(actor, "employee_master", "view")) throw forbidden();
  const today = todayIST();
  const rows = await db.employee.findMany({
    where: { boardId: actor.boardId, status: "ACTIVE", probationEndDate: { not: null }, confirmationDate: null },
    include: { post: true, section: true },
    orderBy: { probationEndDate: "asc" },
    take: 300,
  });
  const pending = await db.approvalTask.findMany({ where: { boardId: actor.boardId, kind: "service_book.entry", status: "PENDING" }, select: { subjectEmployeeId: true, payload: true } });
  const confirming = new Set(pending.map((p) => p.subjectEmployeeId));
  return rows.map((e) => {
    const end = toISODate(e.probationEndDate!);
    return { ...e, probationEnd: end, overdue: end < today, dueSoon: end >= today && end <= addDays(today, 30), confirming: confirming.has(e.id) };
  });
}
