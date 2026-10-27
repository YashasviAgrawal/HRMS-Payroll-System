import "server-only";
import { z } from "zod";
import type { ApprovalTask } from "@/generated/prisma/client";
import { submitForApproval } from "@/lib/approvals/engine";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/session";
import { sendSms } from "@/lib/connectors/sms";
import { db, type Tx } from "@/lib/db";
import { addDays, formatDate, fromISODate, todayIST, toISODate, type ISODate } from "@/lib/dates";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { emit } from "@/lib/outbox";
import { loadFile, mimeOf, saveFile, sniff, type FileKind } from "@/lib/storage";
import { isoDateField } from "@/lib/validators";
import { canManagePension, canSeePension, lcViewOf } from "./pensioners";

/**
 * PN-06: life certificates. Given every November (good until 30 November next year); entered by the Pension clerk when
 * the pensioner signs at the office or brings a Jeevan Pramaan certificate, or uploaded by the pensioner from Jeevan
 * Pramaan and checked by the Pension clerk. An SMS goes a month before the due date and again while it is overdue; a
 * pension more than a month overdue is held by the pension bill (see compute.ts) and paid with the next bill once the
 * certificate is in.
 */
const MAX_BYTES = 5 * 1024 * 1024;
const REMIND_AGAIN_DAYS = 14;

const certificateSchema = z
  .object({
    source: z.enum(["MANUAL", "JEEVAN_PRAMAAN"]),
    certifiedOn: isoDateField,
    jpId: z.string().trim().max(40).optional().transform((v) => v || null),
    note: z.string().trim().max(300).optional().transform((v) => v || null),
  })
  .superRefine((v, ctx) => {
    if (v.certifiedOn > todayIST()) ctx.addIssue({ code: "custom", path: ["certifiedOn"], message: "validation.notFuture" });
    if (v.certifiedOn < addDays(todayIST(), -400)) ctx.addIssue({ code: "custom", path: ["certifiedOn"], message: "pension.errors.certificateOld" });
    if (v.source === "JEEVAN_PRAMAAN" && !v.jpId) ctx.addIssue({ code: "custom", path: ["jpId"], message: "validation.required" });
  });

async function storeCertificate(file: File | null) {
  if (!file) return null;
  if (file.size > MAX_BYTES) throw badRequest("employees.errors.fileTooBig", { file: "employees.errors.fileTooBig" });
  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buffer);
  if (!kind || !["pdf", "png", "jpg"].includes(kind)) throw badRequest("employees.errors.fileType", { file: "employees.errors.fileType" });
  const stored = await saveFile("life-certificates", buffer, kind);
  return { key: stored.key, sha: stored.sha256, name: file.name.slice(0, 120) };
}

/** The Pension clerk enters a certificate seen at the office (or a Jeevan Pramaan one): it counts at once. */
export async function addLifeCertificate(actor: Actor, pensionerId: string, raw: unknown, file: File | null) {
  if (!canManagePension(actor)) throw forbidden();
  const input = certificateSchema.parse(raw);
  const p = await db.pensioner.findFirst({ where: { id: pensionerId, boardId: actor.boardId } });
  if (!p) throw notFound();
  if (p.status !== "ACTIVE") throw conflict("pension.errors.pensionStopped");
  if (p.employeeId === actor.employeeId) throw forbidden("errors.ownPay");
  const stored = await storeCertificate(file);
  return db.$transaction(async (tx) => {
    const c = await tx.lifeCertificate.create({
      data: { boardId: actor.boardId, pensionerId, source: input.source, status: "VERIFIED", certifiedOn: fromISODate(input.certifiedOn), jpId: input.jpId, note: input.note, fileKey: stored?.key, fileSha: stored?.sha, fileName: stored?.name, enteredById: actor.userId, verifiedById: actor.userId, verifiedAt: new Date() },
    });
    await audit(tx, actor, { action: "CREATE", entityType: "LifeCertificate", entityId: c.id, summary: `Life certificate of ${p.payeeName} (PPO ${p.ppoNumber}) dated ${formatDate(input.certifiedOn)} entered`, newValue: { source: input.source, jpId: input.jpId } });
    await emit(tx, actor.boardId, "pension.life_certificate", { type: "Pensioner", id: pensionerId }, { certifiedOn: input.certifiedOn, source: input.source });
    return { id: c.id };
  });
}

/** PN-06, PN-12: the pensioner uploads a Jeevan Pramaan certificate; the Pension clerk checks it. */
export async function submitLifeCertificate(actor: Actor, raw: unknown, file: File | null) {
  if (!actor.pensionerId) throw forbidden();
  const input = certificateSchema.parse({ ...(raw as object), source: "JEEVAN_PRAMAAN" });
  if (!file) throw badRequest("errors.validation", { file: "validation.required" });
  const p = await db.pensioner.findUniqueOrThrow({ where: { id: actor.pensionerId } });
  if (p.status !== "ACTIVE") throw conflict("pension.errors.pensionStopped");
  if (await db.lifeCertificate.count({ where: { pensionerId: p.id, status: "SUBMITTED" } })) throw conflict("pension.errors.certificateWaiting");
  const stored = await storeCertificate(file);
  return db.$transaction(async (tx) => {
    const c = await tx.lifeCertificate.create({
      data: { boardId: actor.boardId, pensionerId: p.id, source: "JEEVAN_PRAMAAN", status: "SUBMITTED", certifiedOn: fromISODate(input.certifiedOn), jpId: input.jpId, note: input.note, fileKey: stored!.key, fileSha: stored!.sha, fileName: stored!.name, enteredById: actor.userId },
    });
    await submitForApproval(tx, actor, {
      kind: "pension.lifecert",
      title: `Life certificate from ${p.payeeName} (PPO ${p.ppoNumber})`,
      titleHi: `${p.payeeNameHi ?? p.payeeName} का जीवन प्रमाण पत्र (पीपीओ ${p.ppoNumber})`,
      details: {
        rows: [
          { label: "Jeevan Pramaan ID", labelHi: "जीवन प्रमाण आईडी", new: input.jpId },
          { label: "Date on the certificate", labelHi: "प्रमाण पत्र की तिथि", new: formatDate(input.certifiedOn) },
        ],
        link: `/pension/pensioners/${p.id}`,
        summary: "Open the certificate from the pensioner's page and check the name, PPO and date.",
        summaryHi: "पेंशनभोगी के पृष्ठ से प्रमाण पत्र खोलें और नाम, पीपीओ और तिथि जाँचें।",
      },
      payload: { certificateId: c.id },
      subjectEmployeeId: p.employeeId,
      entityType: "Pensioner",
      entityId: p.id,
    });
    return { id: c.id };
  });
}

export async function onLifeCertificateDecided(tx: Tx, task: ApprovalTask, actor: Actor, certificateId: string, approved: boolean, note: string | null) {
  const c = await tx.lifeCertificate.update({ where: { id: certificateId }, data: { status: approved ? "VERIFIED" : "REJECTED", verifiedById: actor.userId, verifiedAt: new Date(), note: approved ? undefined : note } });
  await audit(tx, actor, { action: approved ? "APPROVE" : "REJECT", entityType: "LifeCertificate", entityId: c.id, summary: `${approved ? "Accepted" : "Returned"} the Jeevan Pramaan certificate dated ${formatDate(toISODate(c.certifiedOn))}${note ? `: ${note}` : ""}`, newValue: { taskId: task.id } });
  if (approved) await emit(tx, c.boardId, "pension.life_certificate", { type: "Pensioner", id: c.pensionerId }, { certifiedOn: toISODate(c.certifiedOn), source: c.source });
}

/** A certificate's scan, for the Pension clerk or the pensioner. */
export async function lifeCertificateFile(actor: Actor, certificateId: string) {
  const c = await db.lifeCertificate.findFirst({ where: { id: certificateId, boardId: actor.boardId } });
  if (!c || !c.fileKey) throw notFound();
  if (c.pensionerId !== actor.pensionerId && !canSeePension(actor)) throw forbidden();
  const buffer = await loadFile(c.fileKey);
  const kind = (sniff(buffer) ?? "pdf") as FileKind;
  await audit(db, actor, { action: "DOWNLOAD", entityType: "LifeCertificate", entityId: c.id, summary: `Opened the life certificate dated ${formatDate(toISODate(c.certifiedOn))}`, sensitive: true });
  return { buffer, fileName: c.fileName ?? `life-certificate.${kind}`, mimeType: mimeOf(kind) };
}

/** PN-12: the pensioner's own life certificate status and history. */
export async function myLifeCertificate(actor: Actor) {
  if (!actor.pensionerId) throw forbidden();
  const p = await db.pensioner.findUniqueOrThrow({ where: { id: actor.pensionerId }, include: { lifeCertificates: { orderBy: { certifiedOn: "desc" } } } });
  return {
    ppoNumber: p.ppoNumber,
    status: p.status,
    lc: lcViewOf(p),
    certificates: p.lifeCertificates.map((c) => ({ id: c.id, source: c.source, status: c.status, certifiedOn: toISODate(c.certifiedOn), jpId: c.jpId, hasFile: Boolean(c.fileKey), note: c.status === "REJECTED" ? c.note : null })),
  };
}

const reminded = new Map<string, ISODate>();

/**
 * PN-06: once a day, an SMS to each pensioner whose certificate falls due within a month or is overdue (again every two
 * weeks until it comes in). Runs the first time a pension or home page is opened each day.
 */
export async function sendLifeCertificateReminders(boardId: string, today: ISODate = todayIST()) {
  if (reminded.get(boardId) === today) return 0;
  reminded.set(boardId, today);
  const pensioners = await db.pensioner.findMany({ where: { boardId, status: "ACTIVE", mobile: { not: null } }, include: { lifeCertificates: { select: { certifiedOn: true, status: true } }, users: { select: { language: true } } } });
  const due = pensioners.map((p) => ({ p, lc: lcViewOf(p, today) })).filter(({ lc }) => lc.state !== "VALID" && lc.waiting === 0);
  if (!due.length) return 0;
  const recent = await db.messageLog.findMany({ where: { boardId, template: "lifeCertificate", createdAt: { gte: fromISODate(addDays(today, -REMIND_AGAIN_DAYS)) } }, select: { recipient: true } });
  const sent = new Set(recent.map((m) => m.recipient));
  let count = 0;
  for (const { p, lc } of due) {
    if (!p.mobile || sent.has(p.mobile)) continue;
    const lang = p.users[0]?.language === "hi" ? "hi" : "en";
    await sendSms(boardId, p.mobile, "lifeCertificate", { date: formatDate(lc.validTill, lang), ppo: p.ppoNumber }, lang);
    sent.add(p.mobile);
    count += 1;
  }
  if (count) await audit(db, { boardId, name: "System (life certificates)" }, { action: "NOTIFY", entityType: "LifeCertificate", summary: `Life certificate reminders sent to ${count} pensioners`, category: "SYSTEM" });
  return count;
}

/** For tests: forget that today's reminders were sent. */
export function resetLifeCertificateReminders() {
  reminded.clear();
}
