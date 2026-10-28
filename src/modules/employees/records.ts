import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { pendingFor, submitForApproval } from "@/lib/approvals/engine";
import type { ApprovalDetails } from "@/lib/approvals/details";
import { audit } from "@/lib/audit";
import { canAll, scopeFor } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { seal } from "@/lib/crypto";
import { db } from "@/lib/db";
import { formatDate, fromISODate, toISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { emit } from "@/lib/outbox";
import { loadFile, mimeOf, saveFile, sniff } from "@/lib/storage";
import { getSetting } from "@/modules/settings/service";
import { addressLine, fieldLabel, fullName, maskedIds } from "./present";
import {
  EVENTS_NEEDING_APPROVER,
  familySchema,
  sanctionedSchema,
  selfRequestSchema,
  serviceEntrySchema,
  type FamilyInput,
} from "./schema";
import { assertNoDuplicates, canViewEmployee } from "./service";

const MB = 1024 * 1024;

async function employeeFor(actor: Actor, employeeId: string) {
  const e = await db.employee.findFirst({ where: { id: employeeId, boardId: actor.boardId } });
  if (!e || !canViewEmployee(actor, e)) throw notFound();
  return e;
}

// ── family and nominees (EM-04) ─────────────────────────────────────────────

export async function getFamily(actor: Actor, employeeId: string) {
  await employeeFor(actor, employeeId);
  const [members, nominees] = await Promise.all([
    db.familyMember.findMany({ where: { employeeId }, orderBy: { createdAt: "asc" } }),
    db.nominee.findMany({ where: { employeeId }, orderBy: [{ scheme: "asc" }, { createdAt: "asc" }] }),
  ]);
  return {
    members: members.map((m) => ({ ...m, dateOfBirth: m.dateOfBirth ? toISODate(m.dateOfBirth) : null })),
    nominees: nominees.map((n) => ({ ...n, sharePercent: Number(n.sharePercent) })),
  };
}

/** HR proposes the whole family + nominee list; a Checker approves it (EM-04, "changes go through maker-checker"). */
export async function proposeFamily(actor: Actor, employeeId: string, raw: unknown) {
  if (!canAll(actor, "employee_master", "create")) throw forbidden();
  const input: FamilyInput = familySchema.parse(raw);
  const e = await employeeFor(actor, employeeId);
  if (e.id === actor.employeeId) throw forbidden("errors.ownPay");
  if ((await pendingFor(actor.boardId, "Employee", employeeId, ["employee.family"])).length) throw conflict("employees.errors.pendingChange");

  if (e.status === "DRAFT") {
    await db.$transaction(async (tx) => {
      await replaceFamily(tx, employeeId, input);
      await audit(tx, actor, { action: "UPDATE", entityType: "Employee", entityId: employeeId, summary: `Set family of draft record ${fullName(e)}` });
    });
    return { applied: true, taskId: null };
  }
  const rows: ApprovalDetails["rows"] = [
    ...input.members.map((m) => ({
      label: `Family: ${m.relation.toLowerCase()}`,
      labelHi: `परिवार: ${m.relation.toLowerCase()}`,
      new: `${m.name}${m.dateOfBirth ? ` (${formatDate(m.dateOfBirth)})` : ""}${m.isDependent ? " · dependent" : ""}${m.isAlive ? "" : " · deceased"}`,
    })),
    ...input.nominees.map((n) => ({
      label: `Nominee: ${n.scheme}`,
      labelHi: `नामांकन: ${n.scheme}`,
      new: `${input.members[n.memberIndex]?.name ?? "?"} — ${n.sharePercent}%`,
    })),
  ];
  const task = await db.$transaction((tx) =>
    submitForApproval(tx, actor, {
      kind: "employee.family",
      title: `Family and nominees of ${fullName(e)} (${e.employeeCode})`,
      titleHi: `${e.nameHi ?? fullName(e)} (${e.employeeCode}) — परिवार और नामांकन`,
      details: { link: `/employees/${employeeId}?tab=family`, rows, summary: "The new list replaces the current one." } satisfies ApprovalDetails,
      payload: { employeeId, input },
      entityType: "Employee",
      entityId: employeeId,
      subjectEmployeeId: employeeId,
      note: input.note,
    }),
  );
  return { applied: false, taskId: task.id };
}

export async function replaceFamily(tx: Prisma.TransactionClient, employeeId: string, input: FamilyInput) {
  await tx.nominee.deleteMany({ where: { employeeId } });
  await tx.familyMember.deleteMany({ where: { employeeId } });
  const ids: string[] = [];
  for (const m of input.members) {
    const created = await tx.familyMember.create({
      data: {
        employeeId,
        name: m.name,
        nameHi: m.nameHi,
        relation: m.relation,
        gender: m.gender,
        dateOfBirth: m.dateOfBirth ? fromISODate(m.dateOfBirth) : null,
        isDependent: m.isDependent,
        isDisabled: m.isDisabled,
        isAlive: m.isAlive,
      },
    });
    ids.push(created.id);
  }
  for (const n of input.nominees) {
    await tx.nominee.create({ data: { employeeId, scheme: n.scheme, familyMemberId: ids[n.memberIndex], sharePercent: n.sharePercent } });
  }
}

// ── documents (EM-05) ───────────────────────────────────────────────────────

export async function listDocuments(actor: Actor, employeeId: string) {
  await employeeFor(actor, employeeId);
  return db.employeeDocument.findMany({ where: { employeeId, deletedAt: null }, orderBy: { createdAt: "desc" } });
}

/**
 * Uploads a PDF or image, recognised by its content, within its document type's size limit (Settings → Document types). HR uploads for anyone; an employee may attach a
 * document to their own change request (e.g. a cancelled cheque).
 */
export async function uploadDocument(actor: Actor, employeeId: string, file: File, meta: { category: string; title: string }) {
  const e = await db.employee.findFirst({ where: { id: employeeId, boardId: actor.boardId } });
  if (!e) throw notFound();
  const hr = canAll(actor, "employee_master", "create");
  if (!hr && actor.employeeId !== employeeId) throw forbidden();
  const types = (await getSetting(actor.boardId, "documents")).types.filter((x) => x.active);
  // HR picks any active type; an employee attaching proof to their own request files it as bank proof or Other.
  const allowed = hr ? types : types.filter((x) => x.code === "BANK_PROOF" || x.code === "OTHER");
  const type = allowed.find((x) => x.code === meta.category) ?? types.find((x) => x.code === "OTHER")!;
  if (file.size > type.maxMb * MB) throw badRequest("employees.errors.fileTooBig", { file: "employees.errors.fileTooBig" }, { mb: type.maxMb });
  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buffer);
  if (!kind || !["pdf", "png", "jpg"].includes(kind)) throw badRequest("employees.errors.fileType", { file: "employees.errors.fileType" });
  const category = type.code;
  const title = meta.title.trim().slice(0, 120) || file.name.slice(0, 120);
  const stored = await saveFile("documents", buffer, kind);
  return db.$transaction(async (tx) => {
    const doc = await tx.employeeDocument.create({
      data: {
        employeeId,
        category,
        title,
        fileName: file.name.slice(0, 200),
        mimeType: mimeOf(kind),
        size: stored.size,
        sha256: stored.sha256,
        storageKey: stored.key,
        uploadedById: actor.userId,
        uploadedByName: actor.name,
      },
    });
    await audit(tx, actor, {
      action: "UPLOAD",
      entityType: "EmployeeDocument",
      entityId: doc.id,
      summary: `Uploaded "${title}" for ${fullName(e)}`,
      newValue: { category, fileName: doc.fileName, size: doc.size, sha256: doc.sha256 },
    });
    await emit(tx, actor.boardId, "employee.document_added", { type: "EmployeeDocument", id: doc.id }, { employeeId, category });
    return doc;
  });
}

export async function readDocument(actor: Actor, documentId: string) {
  const doc = await db.employeeDocument.findFirst({ where: { id: documentId, deletedAt: null }, include: { employee: true } });
  if (!doc || doc.employee.boardId !== actor.boardId) throw notFound();
  const scope = scopeFor(actor, "employee_master", "view");
  // Reporting officers see section staff on the list but not their documents.
  if (!(scope === "all" || actor.employeeId === doc.employeeId)) throw forbidden();
  const buffer = await loadFile(doc.storageKey);
  await audit(db, actor, { action: "DOWNLOAD", entityType: "EmployeeDocument", entityId: doc.id, summary: `Opened "${doc.title}" of ${fullName(doc.employee)}` });
  return { buffer, doc };
}

export async function deleteDocument(actor: Actor, documentId: string) {
  if (!canAll(actor, "employee_master", "create")) throw forbidden();
  const doc = await db.employeeDocument.findFirst({ where: { id: documentId, deletedAt: null }, include: { employee: true } });
  if (!doc || doc.employee.boardId !== actor.boardId) throw notFound();
  await db.$transaction(async (tx) => {
    await tx.employeeDocument.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
    await audit(tx, actor, { action: "DELETE", entityType: "EmployeeDocument", entityId: documentId, summary: `Removed "${doc.title}" of ${fullName(doc.employee)}` });
  });
}

// ── service book (EM-06, S-12) ──────────────────────────────────────────────

export async function listServiceBook(actor: Actor, employeeId: string) {
  await employeeFor(actor, employeeId);
  if (!scopeFor(actor, "service_book", "view") && actor.employeeId !== employeeId) throw forbidden();
  const rows = await db.serviceBookEntry.findMany({ where: { employeeId }, orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }] });
  const own = actor.employeeId === employeeId && scopeFor(actor, "service_book", "view") === "own";
  return rows.filter((r) => !own || r.status === "APPROVED");
}

/** HR adds an event; a Checker checks it; appointment, promotion and penalty also need an Admin Approver (§14). */
export async function addServiceEntry(actor: Actor, employeeId: string, raw: unknown) {
  if (!canAll(actor, "service_book", "create")) throw forbidden();
  const input = serviceEntrySchema.parse(raw);
  const e = await employeeFor(actor, employeeId);
  if (e.id === actor.employeeId) throw forbidden("errors.ownPay");
  if (input.documentId) {
    const doc = await db.employeeDocument.findFirst({ where: { id: input.documentId, employeeId, deletedAt: null } });
    if (!doc) throw badRequest("errors.validation", { documentId: "validation.invalid" });
  }
  return db.$transaction(async (tx) => {
    const entry = await tx.serviceBookEntry.create({
      data: {
        employeeId,
        event: input.event,
        eventDate: fromISODate(input.eventDate),
        orderNumber: input.orderNumber,
        orderDate: input.orderDate ? fromISODate(input.orderDate) : null,
        details: input.details,
        detailsHi: input.detailsHi,
        documentId: input.documentId ?? null,
        createdById: actor.userId,
      },
    });
    const needsApprover = (EVENTS_NEEDING_APPROVER as readonly string[]).includes(input.event);
    await submitForApproval(tx, actor, {
      kind: "service_book.entry",
      title: `Service book: ${input.event.toLowerCase().replace("_", " ")} — ${fullName(e)} (${e.employeeCode})`,
      titleHi: `सेवा पुस्तिका प्रविष्टि — ${e.nameHi ?? fullName(e)} (${e.employeeCode})`,
      details: {
        link: `/employees/${employeeId}?tab=serviceBook`,
        summary: needsApprover ? "After the Checker, an Admin Approver also approves this entry." : undefined,
        summaryHi: needsApprover ? "जाँचकर्ता के बाद प्रशासक स्वीकृतिकर्ता भी इसे स्वीकृत करेंगे।" : undefined,
        rows: [
          { label: "Event", labelHi: "घटना", new: input.event },
          { label: "Date", labelHi: "तिथि", new: formatDate(input.eventDate) },
          { label: "Order", labelHi: "आदेश", new: [input.orderNumber, input.orderDate ? formatDate(input.orderDate) : null].filter(Boolean).join(" dated ") || null },
          { label: "Details", labelHi: "विवरण", new: input.details },
        ],
      } satisfies ApprovalDetails,
      payload: { entryId: entry.id, needsApprover },
      entityType: "ServiceBookEntry",
      entityId: entry.id,
      subjectEmployeeId: employeeId,
    });
    return entry;
  });
}

// ── employee self-service requests (EM-08) ──────────────────────────────────

export async function submitSelfRequest(actor: Actor, raw: unknown) {
  if (!actor.employeeId || !actor.isEmployee) throw forbidden();
  const input = selfRequestSchema.parse(raw);
  const e = await db.employee.findUniqueOrThrow({ where: { id: actor.employeeId } });
  const open = await db.approvalTask.findMany({
    where: { boardId: actor.boardId, kind: "employee.self_request", status: "PENDING", subjectEmployeeId: e.id },
  });
  if (open.some((t) => (t.payload as { kind?: string }).kind === input.kind)) throw conflict("employees.errors.pendingRequest");

  type Row = NonNullable<ApprovalDetails["rows"]>[number];
  let rows: Row[] = [];
  let data: Record<string, unknown> = {};
  /** field → row, so the approved change is written to the history under the right field name. */
  let fields: string[] = [];
  if (input.kind === "address") {
    data = { presentAddress: input.presentAddress, permanentAddress: input.permanentAddress };
    rows = [
      { ...fieldLabel("presentAddress"), old: addressLine(e.presentAddress), new: addressLine(input.presentAddress) },
      { ...fieldLabel("permanentAddress"), old: addressLine(e.permanentAddress), new: addressLine(input.permanentAddress) },
    ];
    fields = ["presentAddress", "permanentAddress"];
  } else if (input.kind === "mobile") {
    data = { mobile: input.mobile };
    rows = [{ ...fieldLabel("mobile"), old: e.mobile, new: input.mobile }];
    fields = ["mobile"];
  } else if (input.kind === "bank") {
    const sealed = seal("bank", input.bankAccount);
    await assertNoDuplicates(actor.boardId, { bankAccount: sealed.hash }, e.id, db, "");
    if (input.documentId && !(await db.employeeDocument.findFirst({ where: { id: input.documentId, employeeId: e.id } }))) {
      throw badRequest("errors.validation", { documentId: "validation.invalid" });
    }
    data = {
      bankAccountEnc: sealed.enc,
      bankAccountHash: sealed.hash,
      bankAccountLast4: sealed.last4,
      ifsc: input.ifsc,
      bankName: input.bankName,
      bankBranch: input.bankBranch,
    };
    rows = [
      { ...fieldLabel("bankAccount"), old: maskedIds(e).bankAccount, new: maskedIds({ panLast4: null, aadhaarLast4: null, bankAccountLast4: sealed.last4 }).bankAccount, reveal: "bankAccount" },
      { ...fieldLabel("ifsc"), old: e.ifsc, new: input.ifsc },
      { ...fieldLabel("bankName"), old: e.bankName, new: input.bankName },
    ];
    fields = ["bankAccount", "ifsc", "bankName"];
  } else {
    rows = [{ label: "Requested change", labelHi: "माँगा गया बदलाव", new: input.details }];
  }

  const titles = {
    address: ["Change of address", "पते में बदलाव"],
    mobile: ["Change of mobile number", "मोबाइल नंबर में बदलाव"],
    bank: ["Change of bank account", "बैंक खाते में बदलाव"],
    nominee: ["Change of nominee", "नामांकन में बदलाव"],
  }[input.kind];
  return db.$transaction((tx) =>
    submitForApproval(tx, actor, {
      kind: "employee.self_request",
      title: `${titles[0]} — ${fullName(e)} (${e.employeeCode})`,
      titleHi: `${titles[1]} — ${e.nameHi ?? fullName(e)} (${e.employeeCode})`,
      details: {
        link: `/employees/${e.id}`,
        summary: input.kind === "bank" ? "Raised by the employee. After HR, a Checker approves the new account before salary goes to it (EM-07)." : "Raised by the employee (EM-08).",
        summaryHi: input.kind === "bank" ? "कर्मचारी द्वारा। एचआर के बाद जाँचकर्ता नए खाते को स्वीकृत करेंगे, तभी वेतन उसमें जाएगा।" : "कर्मचारी द्वारा भेजा गया (EM-08)।",
        rows,
      } satisfies ApprovalDetails,
      payload: {
        kind: input.kind,
        employeeId: e.id,
        data,
        documentId: input.kind === "bank" ? (input.documentId ?? null) : null,
        history: fields.map((field, i) => ({ field, old: rows[i].old ?? null, new: rows[i].new ?? null, sensitive: field === "bankAccount" })),
      },
      entityType: "Employee",
      entityId: e.id,
      subjectEmployeeId: e.id,
      note: input.note,
    }),
  );
}

export async function myRequests(actor: Actor) {
  if (!actor.employeeId) return [];
  const tasks = await db.approvalTask.findMany({
    where: { boardId: actor.boardId, subjectEmployeeId: actor.employeeId, kind: { in: ["employee.self_request", "employee.update"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const mine = tasks.filter((t) => t.makerId === actor.userId);
  // A bank change continues as a Checker step after HR approves it; show the latest step of each request.
  return mine.map((t) => {
    const child = tasks.find((c) => (c.payload as { parentTaskId?: string }).parentTaskId === t.id);
    return { ...t, child };
  });
}

// ── sanctioned vs filled posts (EM-09, S-14) ────────────────────────────────

export async function sanctionedOverview(actor: Actor) {
  if (!scopeFor(actor, "employee_master", "view") || actor.loginType === "EMPLOYEE") throw forbidden();
  const [sanctions, filled, sections, posts] = await Promise.all([
    db.sanctionedPost.findMany({ where: { boardId: actor.boardId } }),
    db.employee.groupBy({
      by: ["sectionId", "postId"],
      where: { boardId: actor.boardId, status: { in: ["ACTIVE", "SUSPENDED"] }, type: { in: ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION"] } },
      _count: { _all: true },
    }),
    db.section.findMany({ where: { boardId: actor.boardId, isActive: true }, orderBy: { name: "asc" } }),
    db.post.findMany({ where: { boardId: actor.boardId, isActive: true } }),
  ]);
  const key = (s: string, p: string) => `${s}:${p}`;
  const map = new Map<string, { sectionId: string; postId: string; sanctioned: number; filled: number }>();
  for (const s of sanctions) map.set(key(s.sectionId, s.postId), { sectionId: s.sectionId, postId: s.postId, sanctioned: s.sanctioned, filled: 0 });
  for (const f of filled) {
    const k = key(f.sectionId, f.postId);
    const row = map.get(k) ?? { sectionId: f.sectionId, postId: f.postId, sanctioned: 0, filled: 0 };
    row.filled = f._count._all;
    map.set(k, row);
  }
  const postById = new Map(posts.map((p) => [p.id, p]));
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const rows = [...map.values()]
    .filter((r) => sectionById.has(r.sectionId) && postById.has(r.postId))
    .map((r) => ({ ...r, section: sectionById.get(r.sectionId)!, post: postById.get(r.postId)!, vacant: Math.max(0, r.sanctioned - r.filled), excess: Math.max(0, r.filled - r.sanctioned) }))
    .sort((a, b) => a.section.name.localeCompare(b.section.name) || b.post.payLevel.localeCompare(a.post.payLevel, undefined, { numeric: true }));
  return { rows, sections, posts };
}

/** Vacant sanctioned posts for a section + post (used by recruitment, RO-01). */
export async function vacantCount(boardId: string, sectionId: string, postId: string) {
  const [s, filled] = await Promise.all([
    db.sanctionedPost.findUnique({ where: { boardId_sectionId_postId: { boardId, sectionId, postId } } }),
    db.employee.count({ where: { boardId, sectionId, postId, status: { in: ["ACTIVE", "SUSPENDED", "DRAFT"] }, type: { in: ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION"] } } }),
  ]);
  return Math.max(0, (s?.sanctioned ?? 0) - filled);
}

export async function proposeSanctioned(actor: Actor, raw: unknown) {
  if (!canAll(actor, "employee_master", "create")) throw forbidden();
  const input = sanctionedSchema.parse(raw);
  const [sections, posts, current] = await Promise.all([
    db.section.findMany({ where: { boardId: actor.boardId } }),
    db.post.findMany({ where: { boardId: actor.boardId } }),
    db.sanctionedPost.findMany({ where: { boardId: actor.boardId } }),
  ]);
  const sName = new Map(sections.map((s) => [s.id, s.name]));
  const pName = new Map(posts.map((p) => [p.id, p.name]));
  const rows = input.rows
    .filter((r) => sName.has(r.sectionId) && pName.has(r.postId))
    .map((r) => {
      const before = current.find((c) => c.sectionId === r.sectionId && c.postId === r.postId);
      return { ...r, old: before?.sanctioned ?? 0 };
    })
    .filter((r) => r.old !== r.sanctioned);
  if (!rows.length) throw badRequest("employees.errors.noChanges");
  if ((await pendingFor(actor.boardId, "SanctionedPost", actor.boardId)).length) throw conflict("employees.errors.pendingChange");
  return db.$transaction((tx) =>
    submitForApproval(tx, actor, {
      kind: "sanctioned.update",
      title: "Change in sanctioned strength",
      titleHi: "स्वीकृत पद संख्या में बदलाव",
      details: {
        link: "/employees/posts",
        summary: input.orderRef ? `Sanction order: ${input.orderRef}` : undefined,
        rows: rows.map((r) => ({ label: `${sName.get(r.sectionId)} — ${pName.get(r.postId)}`, old: String(r.old), new: String(r.sanctioned) })),
      } satisfies ApprovalDetails,
      payload: { rows, orderRef: input.orderRef },
      entityType: "SanctionedPost",
      entityId: actor.boardId,
      note: input.note,
    }),
  );
}

// ── S-13: change requests ───────────────────────────────────────────────────

export const EMPLOYEE_TASK_KINDS = [
  "employee.create",
  "employee.bulk_create",
  "employee.update",
  "employee.family",
  "employee.self_request",
  "service_book.entry",
  "sanctioned.update",
];

/** Every pending employee-record item, so HR and Checkers see the whole queue — not only their own inbox. */
export async function employeeRequests(actor: Actor) {
  if (!canAll(actor, "employee_master", "view")) throw forbidden();
  return db.approvalTask.findMany({
    where: { boardId: actor.boardId, status: "PENDING", kind: { in: EMPLOYEE_TASK_KINDS } },
    orderBy: { createdAt: "asc" },
    take: 300,
  });
}

// ─── Scanned service books (client add-on) ────────────────────────────────────

export type ServiceBookUpload = {
  fileName: string;
  status: "saved" | "noCode" | "noEmployee" | "tooBig" | "badType";
  employeeId?: string;
  employeeCode?: string;
  name?: string;
};

/** The Employee ID at the start of a file name: "DCB10009.pdf", "dcb10009 part 2.pdf", "DCB10009_SB.pdf". */
export function codeFromFileName(fileName: string): string | null {
  return fileName.trim().match(/^([A-Za-z]{2,6}\d{3,8})(?![0-9])/)?.[1]?.toUpperCase() ?? null;
}

/**
 * Scanned service books of existing and older staff, many at once: each file is matched to the employee whose ID
 * starts its name and kept as a "Scanned service book" document. Files that cannot be matched are reported, not kept.
 */
export async function uploadServiceBooks(actor: Actor, files: File[]): Promise<ServiceBookUpload[]> {
  if (!canAll(actor, "employee_master", "create")) throw forbidden();
  if (!files.length) throw badRequest("errors.validation", { files: "validation.required" });
  if (files.length > 20) throw badRequest("employees.serviceBookScans.tooMany");
  const codes = [...new Set(files.map((f) => codeFromFileName(f.name)).filter((c): c is string => Boolean(c)))];
  const employees = new Map((await db.employee.findMany({ where: { boardId: actor.boardId, employeeCode: { in: codes } } })).map((e) => [e.employeeCode!, e]));
  const out: ServiceBookUpload[] = [];
  for (const file of files) {
    const code = codeFromFileName(file.name);
    if (!code) {
      out.push({ fileName: file.name, status: "noCode" });
      continue;
    }
    const e = employees.get(code);
    if (!e) {
      out.push({ fileName: file.name, status: "noEmployee", employeeCode: code });
      continue;
    }
    const who = { employeeId: e.id, employeeCode: code, name: fullName(e) };
    try {
      await uploadDocument(actor, e.id, file, { category: "SERVICE_BOOK", title: `Service book (scanned) — ${file.name}` });
      out.push({ fileName: file.name, status: "saved", ...who });
    } catch (err) {
      const key = (err as { key?: string }).key;
      if (key === "employees.errors.fileTooBig") out.push({ fileName: file.name, status: "tooBig", ...who });
      else if (key === "employees.errors.fileType") out.push({ fileName: file.name, status: "badType", ...who });
      else throw err;
    }
  }
  return out;
}
