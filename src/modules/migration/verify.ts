import "server-only";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, toISODate } from "@/lib/dates";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { embeddedFonts, logoDataUrl, renderPdf } from "@/lib/pdf";
import { fullName } from "@/modules/employees/present";
import { assertOpen, canCheckMigration, canSeeMigration, canWorkMigration, cutOverOf } from "./staging";

/**
 * §15 step 7: every record is compared with the paper service book (HR; the pension file for pensioners), confirmed
 * by the person — online, or on a printed sheet they sign — and then locked by a Checker.
 */
export type VerifyKind = "staff" | "pensioners";

const canCompare = (actor: Actor) => canWorkMigration(actor) && actor.permissions.some((p) => p === "HR" || p === "PENSION");

export async function verificationList(actor: Actor, kind: VerifyKind, opts: { q?: string; state?: string } = {}) {
  if (!canSeeMigration(actor)) throw forbidden();
  const q = opts.q?.trim();
  type Row = { id: string; code: string; name: string; nameHi: string | null; section: string; sectionHi: string; serviceBook: { by: string | null; at: string } | null; confirmed: { via: string | null; by: string | null; at: string } | null; locked: { by: string | null; at: string } | null; own: boolean };
  let rows: Row[];
  if (kind === "staff") {
    const staff = await db.employee.findMany({
      where: { boardId: actor.boardId, status: { in: ["ACTIVE", "SUSPENDED"] }, ...(q ? { OR: [{ employeeCode: { contains: q, mode: "insensitive" } }, { firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } : {}) },
      select: { id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, nameHi: true, section: { select: { name: true, nameHi: true } }, verification: true },
      orderBy: { employeeCode: "asc" },
    });
    rows = staff.map((e) => ({ id: e.id, code: e.employeeCode ?? "", name: fullName(e), nameHi: e.nameHi, section: e.section.name, sectionHi: e.section.nameHi, ...stateOf(e.verification), own: e.id === actor.employeeId }));
  } else {
    const people = await db.pensioner.findMany({
      where: { boardId: actor.boardId, status: "ACTIVE", ...(q ? { OR: [{ ppoNumber: { contains: q, mode: "insensitive" } }, { payeeName: { contains: q, mode: "insensitive" } }] } : {}) },
      select: { id: true, ppoNumber: true, payeeName: true, payeeNameHi: true, employeeId: true, employee: { select: { section: { select: { name: true, nameHi: true } } } }, verification: true },
      orderBy: { ppoNumber: "asc" },
    });
    rows = people.map((p) => ({ id: p.id, code: p.ppoNumber, name: p.payeeName, nameHi: p.payeeNameHi, section: p.employee.section.name, sectionHi: p.employee.section.nameHi, ...stateOf(p.verification), own: p.employeeId === actor.employeeId }));
  }
  const counts = { total: rows.length, serviceBook: rows.filter((r) => r.serviceBook).length, confirmed: rows.filter((r) => r.confirmed).length, locked: rows.filter((r) => r.locked).length };
  const filtered = rows.filter((r) => (opts.state === "TODO" ? !r.locked : opts.state === "READY" ? r.serviceBook && r.confirmed && !r.locked : opts.state === "LOCKED" ? Boolean(r.locked) : true));
  const open = !(await cutOverOf(actor.boardId));
  return { kind, rows: filtered, counts, canCompare: open && canCompare(actor), canLock: open && canCheckMigration(actor) };
}

function stateOf(v: { serviceBookByName: string | null; serviceBookAt: Date | null; confirmedVia: string | null; confirmedByName: string | null; confirmedAt: Date | null; lockedByName: string | null; lockedAt: Date | null } | null) {
  return {
    serviceBook: v?.serviceBookAt ? { by: v.serviceBookByName, at: v.serviceBookAt.toISOString() } : null,
    confirmed: v?.confirmedAt ? { via: v.confirmedVia, by: v.confirmedByName, at: v.confirmedAt.toISOString() } : null,
    locked: v?.lockedAt ? { by: v.lockedByName, at: v.lockedAt.toISOString() } : null,
  };
}

const idsSchema = z.object({ kind: z.enum(["staff", "pensioners"]), ids: z.array(z.string().min(1)).min(1).max(2000) });
const whereOf = (kind: VerifyKind, id: string) => (kind === "staff" ? { employeeId: id } : { pensionerId: id });

async function ensureRows(actor: Actor, kind: VerifyKind, ids: string[]) {
  const found =
    kind === "staff"
      ? await db.employee.findMany({ where: { boardId: actor.boardId, id: { in: ids }, status: { in: ["ACTIVE", "SUSPENDED"] } }, select: { id: true } })
      : await db.pensioner.findMany({ where: { boardId: actor.boardId, id: { in: ids }, status: "ACTIVE" }, select: { id: true } });
  if (found.length !== new Set(ids).size) throw notFound();
}

/** HR has compared these records with the paper service book (or the pension file). */
export async function markServiceBook(actor: Actor, raw: unknown) {
  if (!canCompare(actor)) throw forbidden();
  await assertOpen(actor);
  const { kind, ids } = idsSchema.parse(raw);
  await ensureRows(actor, kind, ids);
  await db.$transaction(async (tx) => {
    for (const id of ids) {
      await tx.recordVerification.upsert({
        where: kind === "staff" ? { employeeId: id } : { pensionerId: id },
        create: { boardId: actor.boardId, ...whereOf(kind, id), serviceBookById: actor.userId, serviceBookByName: actor.name, serviceBookAt: new Date() },
        update: { serviceBookById: actor.userId, serviceBookByName: actor.name, serviceBookAt: new Date() },
      });
    }
    await audit(tx, actor, { action: "VERIFY", entityType: "RecordVerification", entityId: ids[0], summary: `Compared ${ids.length} ${kind === "staff" ? "employee records" : "pension records"} with the paper service book` });
  });
  return { count: ids.length };
}

/** The person signed the printed sheet; HR records it. */
export async function markSheet(actor: Actor, raw: unknown) {
  if (!canCompare(actor)) throw forbidden();
  await assertOpen(actor);
  const { kind, ids } = idsSchema.parse(raw);
  await ensureRows(actor, kind, ids);
  await db.$transaction(async (tx) => {
    for (const id of ids) {
      await tx.recordVerification.upsert({
        where: kind === "staff" ? { employeeId: id } : { pensionerId: id },
        create: { boardId: actor.boardId, ...whereOf(kind, id), confirmedVia: "SHEET", confirmedByName: actor.name, confirmedAt: new Date() },
        update: { confirmedVia: "SHEET", confirmedByName: actor.name, confirmedAt: new Date() },
      });
    }
    await audit(tx, actor, { action: "VERIFY", entityType: "RecordVerification", entityId: ids[0], summary: `Recorded ${ids.length} signed record sheets` });
  });
  return { count: ids.length };
}

/** A Checker locks records that were compared and confirmed; never their own (PRD §2 rule 2). */
export async function lockRecords(actor: Actor, raw: unknown) {
  if (!canCheckMigration(actor)) throw forbidden();
  await assertOpen(actor);
  const { kind, ids } = idsSchema.parse(raw);
  const rows = await db.recordVerification.findMany({ where: { boardId: actor.boardId, ...(kind === "staff" ? { employeeId: { in: ids } } : { pensionerId: { in: ids } }) }, include: { pensioner: { select: { employeeId: true } } } });
  const ready = rows.filter((r) => r.serviceBookAt && r.confirmedAt && !r.lockedAt && r.employeeId !== actor.employeeId && r.pensioner?.employeeId !== actor.employeeId);
  if (!ready.length) throw badRequest("migration.errors.notReadyToLock");
  await db.$transaction(async (tx) => {
    await tx.recordVerification.updateMany({ where: { id: { in: ready.map((r) => r.id) } }, data: { lockedById: actor.userId, lockedByName: actor.name, lockedAt: new Date() } });
    await audit(tx, actor, { action: "APPROVE", entityType: "RecordVerification", entityId: ready[0].id, summary: `Locked ${ready.length} verified ${kind === "staff" ? "employee records" : "pension records"}` });
  });
  return { count: ready.length, skipped: ids.length - ready.length };
}

/** The person's own record, confirmed online (an Employee or Pensioner login, §14 "confirm own record"). */
export async function confirmOwnRecord(actor: Actor) {
  if (!can(actor, "migration", "create")) throw forbidden();
  await assertOpen(actor);
  const kind: VerifyKind = actor.pensionerId && !actor.isEmployee ? "pensioners" : "staff";
  const id = kind === "staff" ? actor.employeeId : actor.pensionerId;
  if (!id) throw forbidden();
  await db.$transaction(async (tx) => {
    await tx.recordVerification.upsert({
      where: kind === "staff" ? { employeeId: id } : { pensionerId: id },
      create: { boardId: actor.boardId, ...whereOf(kind, id), confirmedVia: "SELF", confirmedByName: actor.name, confirmedAt: new Date() },
      update: { confirmedVia: "SELF", confirmedByName: actor.name, confirmedAt: new Date() },
    });
    await audit(tx, actor, { action: "VERIFY", entityType: "RecordVerification", entityId: id, summary: "Confirmed my own record is correct" });
  });
  return { ok: true };
}

/** What My record shows: ask while the migration is open and the record is not yet confirmed. */
export async function ownRecordState(actor: Actor) {
  if (!can(actor, "migration", "create") || (await cutOverOf(actor.boardId))) return null;
  const v = actor.pensionerId && !actor.isEmployee ? await db.recordVerification.findUnique({ where: { pensionerId: actor.pensionerId } }) : actor.employeeId ? await db.recordVerification.findUnique({ where: { employeeId: actor.employeeId } }) : null;
  return { confirmedAt: v?.confirmedAt?.toISOString() ?? null, via: v?.confirmedVia ?? null };
}

const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The printed sheet for people who do not use the system: their record as held here, to check and sign. */
export async function verificationSheetPdf(actor: Actor, employeeId: string) {
  if (!canCompare(actor)) throw forbidden();
  const e = await db.employee.findFirst({
    where: { id: employeeId, boardId: actor.boardId },
    include: { post: true, section: true, family: { orderBy: { createdAt: "asc" } }, nominees: true },
  });
  if (!e) throw notFound();
  const board = await db.board.findUniqueOrThrow({ where: { id: actor.boardId } });
  const d = (v: Date | null) => (v ? formatDate(toISODate(v)) : "—");
  const rows: [string, string, string][] = [
    ["Employee ID", "कर्मचारी आईडी", e.employeeCode ?? "—"],
    ["Name", "नाम", `${fullName(e)}${e.nameHi ? ` / ${e.nameHi}` : ""}`],
    ["Father / spouse", "पिता / पति-पत्नी", e.fatherOrSpouseName ?? "—"],
    ["Date of birth", "जन्म तिथि", d(e.dateOfBirth)],
    ["Date of joining", "कार्यग्रहण तिथि", d(e.dateOfJoining)],
    ["Retires on", "सेवानिवृत्ति", d(e.dateOfRetirement)],
    ["Post · section", "पद · अनुभाग", `${e.post.name} · ${e.section.name}`],
    ["Pay level · cell", "वेतन स्तर · सेल", e.payLevel ? `${e.payLevel} · ${e.payCell ?? "—"}` : "—"],
    ["Category", "श्रेणी", e.category ?? "—"],
    ["Mobile", "मोबाइल", e.mobile ?? "—"],
    ["PAN", "पैन", e.panLast4 ? `••••••${e.panLast4}` : "—"],
    ["Aadhaar", "आधार", e.aadhaarLast4 ? `•••• •••• ${e.aadhaarLast4}` : "—"],
    ["Bank account · IFSC", "बैंक खाता · आईएफएससी", e.bankAccountLast4 ? `••••${e.bankAccountLast4} · ${e.ifsc ?? ""}` : "—"],
    ["PRAN / UAN / GPF no.", "पीआरएएन / यूएएन / जीपीएफ सं.", [e.pran, e.uan, e.gpfNumber].filter(Boolean).join(" / ") || "—"],
  ];
  const family = e.family.map((f) => `<tr><td>${esc(f.name)}</td><td>${esc(f.relation)}</td><td>${esc(d(f.dateOfBirth))}</td></tr>`).join("");
  const logo = logoDataUrl();
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    ${embeddedFonts()}
    @page { size: A4; margin: 14mm; }
    body { font-family: 'Inter', 'Noto Sans Devanagari', sans-serif; color: #17201b; font-size: 10pt; margin: 0; }
    header { display: flex; gap: 12px; align-items: center; border-bottom: 2px solid #116541; padding-bottom: 8px; }
    header img { height: 62px; width: auto; } h1 { margin: 0; font-size: 13pt; color: #0f432e; } header p { margin: 2px 0 0; color: #4f5d56; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; } td, th { border: 1px solid #d5ddd9; padding: 5px 7px; text-align: left; vertical-align: top; }
    th { background: #edfaf2; color: #115136; width: 34%; font-weight: 600; } .hi { color: #4f5d56; font-weight: 400; }
    h2 { font-size: 11pt; color: #0f432e; margin: 16px 0 4px; } .box { margin-top: 14px; padding: 10px; border: 1px solid #9aa8a1; border-radius: 6px; }
    .signs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 34px; font-size: 9pt; } .signs div { border-top: 1px solid #9aa8a1; padding-top: 4px; }
    footer { margin-top: 18px; font-size: 8pt; color: #56645d; }
  </style></head><body>
    <header>${logo ? `<img src="${logo}" alt="">` : ""}<div><h1>${esc(board.name)} · ${esc(board.nameHi)}</h1><p>Record check before the new system starts · नई प्रणाली शुरू होने से पहले रिकॉर्ड की जाँच</p></div></header>
    <table>${rows.map(([en, hi, v]) => `<tr><th>${esc(en)} <span class="hi">/ ${esc(hi)}</span></th><td>${esc(v)}</td></tr>`).join("")}</table>
    ${family ? `<h2>Family · परिवार</h2><table><tr><th>Name · नाम</th><th>Relation · संबंध</th><th>Date of birth · जन्म तिथि</th></tr>${family}</table>` : ""}
    <div class="box">Please check every line. If something is wrong, write the correct value next to it. Then sign below.<br><span class="hi">कृपया हर पंक्ति जाँचें। कुछ गलत हो तो उसके आगे सही जानकारी लिखें। फिर नीचे हस्ताक्षर करें।</span></div>
    <div class="signs"><div>Employee's signature and date<br>कर्मचारी के हस्ताक्षर और तिथि</div><div>Compared with the service book by (HR)<br>सेवा पुस्तिका से मिलान (एचआर)</div><div>Locked by (Checker)<br>लॉक किया (जाँचकर्ता)</div></div>
    <footer>Printed ${esc(formatDateTime(new Date()))} by ${esc(actor.name)} · DCB HRMS · ${esc(e.employeeCode ?? "")}</footer>
  </body></html>`;
  const pdf = await renderPdf(html);
  await audit(db, actor, { action: "PRINT", entityType: "Employee", entityId: e.id, summary: `Printed the record check sheet of ${e.employeeCode ?? fullName(e)}` });
  return { pdf, fileName: `Record-check-${e.employeeCode ?? e.id}.pdf` };
}
