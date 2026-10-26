import "server-only";
import { audit, type AuditWho } from "@/lib/audit";
import type { Actor } from "@/lib/auth/session";
import { db, type DbLike } from "@/lib/db";
import { formatDate, monthOf, toISODate, todayIST, type ISODate } from "@/lib/dates";
import { badRequest, forbidden } from "@/lib/errors";
import { emit } from "@/lib/outbox";
import { saveFile, sniff } from "@/lib/storage";
import { getSetting } from "@/modules/settings/service";
import { parseAttlog, parsePunchFile, type ParsedPunch, type PunchFormat } from "./formats";
import { canEnterMuster } from "./service";

export interface PunchCheck {
  rows: number;
  /** New punches that will be saved. */
  ready: number;
  alreadySaved: number;
  duplicatesInFile: number;
  unknownIds: { id: string; count: number }[];
  notOnRolls: number;
  locked: number;
  future: number;
  errors: { line: number; key: string; text: string }[];
  errorCount: number;
  from: ISODate | null;
  to: ISODate | null;
  people: number;
}

interface Checked {
  summary: PunchCheck;
  toSave: { employeeId: string; at: Date }[];
}

/** Sorts punches into: ready to save, already saved, unknown ID, not on the rolls that day, locked month, future. */
async function classify(boardId: string, punches: ParsedPunch[], tx: DbLike = db): Promise<Checked> {
  const now = new Date();
  const today = todayIST(now);
  const ids = [...new Set(punches.map((p) => p.biometricId))];
  const employees = ids.length
    ? await tx.employee.findMany({ where: { boardId, biometricId: { in: ids }, employeeCode: { not: null } }, select: { id: true, biometricId: true, sectionId: true, dateOfJoining: true, exitDate: true } })
    : [];
  const byBio = new Map(employees.map((e) => [e.biometricId!, e]));
  const locks = await tx.attendanceLock.findMany({ where: { boardId, unlockedAt: null }, select: { sectionId: true, month: true } });
  const locked = new Set(locks.map((l) => `${l.sectionId}|${l.month}`));

  const unknown = new Map<string, number>();
  const seen = new Set<string>();
  const candidates: { employeeId: string; at: Date; date: ISODate }[] = [];
  let duplicatesInFile = 0;
  let notOnRolls = 0;
  let lockedCount = 0;
  let future = 0;
  for (const p of punches) {
    const e = byBio.get(p.biometricId);
    if (!e) {
      unknown.set(p.biometricId, (unknown.get(p.biometricId) ?? 0) + 1);
      continue;
    }
    if (p.at.getTime() > now.getTime() + 5 * 60_000 || p.date > today) {
      future += 1;
      continue;
    }
    if (p.date < toISODate(e.dateOfJoining) || (e.exitDate && p.date > toISODate(e.exitDate))) {
      notOnRolls += 1;
      continue;
    }
    if (locked.has(`${e.sectionId}|${monthOf(p.date)}`)) {
      lockedCount += 1;
      continue;
    }
    const key = `${e.id}|${p.at.getTime()}`;
    if (seen.has(key)) {
      duplicatesInFile += 1;
      continue;
    }
    seen.add(key);
    candidates.push({ employeeId: e.id, at: p.at, date: p.date });
  }

  let alreadySaved = 0;
  let toSave = candidates;
  if (candidates.length) {
    const times = candidates.map((c) => c.at.getTime());
    const existing = await tx.attendancePunch.findMany({
      where: { employeeId: { in: [...new Set(candidates.map((c) => c.employeeId))] }, at: { gte: new Date(Math.min(...times)), lte: new Date(Math.max(...times)) } },
      select: { employeeId: true, at: true },
    });
    const have = new Set(existing.map((x) => `${x.employeeId}|${x.at.getTime()}`));
    toSave = candidates.filter((c) => !have.has(`${c.employeeId}|${c.at.getTime()}`));
    alreadySaved = candidates.length - toSave.length;
  }
  const dates = toSave.map((c) => c.date).sort();
  return {
    summary: {
      rows: punches.length,
      ready: toSave.length,
      alreadySaved,
      duplicatesInFile,
      unknownIds: [...unknown.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
      notOnRolls,
      locked: lockedCount,
      future,
      errors: [],
      errorCount: 0,
      from: dates[0] ?? null,
      to: dates.at(-1) ?? null,
      people: new Set(toSave.map((c) => c.employeeId)).size,
    },
    toSave: toSave.map(({ employeeId, at }) => ({ employeeId, at })),
  };
}

async function readFile(buffer: Buffer, fileName: string, format: PunchFormat) {
  const parsed = await parsePunchFile(buffer, fileName, format);
  if (parsed.unreadable) throw badRequest("attendance.import.unreadable", { file: "attendance.import.unreadable" });
  return parsed;
}

/** AT-01: read the file and say exactly what would be saved, before anything is saved. */
export async function checkPunchFile(actor: Actor, buffer: Buffer, fileName: string, format: PunchFormat): Promise<PunchCheck> {
  if (!canEnterMuster(actor)) throw forbidden();
  const parsed = await readFile(buffer, fileName, format);
  const { summary } = await classify(actor.boardId, parsed.punches);
  return { ...summary, errors: parsed.errors.slice(0, 50), errorCount: parsed.errors.length };
}

/** Saves the new punches from a checked file and keeps the file itself with its checksum. */
export async function savePunchFile(actor: Actor, buffer: Buffer, fileName: string, format: PunchFormat) {
  if (!canEnterMuster(actor)) throw forbidden();
  const parsed = await readFile(buffer, fileName, format);
  return db.$transaction(
    async (tx) => {
      const { summary, toSave } = await classify(actor.boardId, parsed.punches, tx);
      if (toSave.length === 0) throw badRequest("attendance.import.nothingNew");
      const stored = await saveFile("attendance", buffer, sniff(buffer) === "xlsx" ? "xlsx" : /\.csv$/i.test(fileName) ? "csv" : "txt");
      const record = await tx.attendanceImport.create({
        data: {
          boardId: actor.boardId,
          format,
          fileName: fileName.slice(0, 200),
          storageKey: stored.key,
          sha256: stored.sha256,
          rowCount: parsed.punches.length + parsed.errors.length,
          savedCount: toSave.length,
          duplicateCount: summary.alreadySaved + summary.duplicatesInFile,
          fromDate: new Date(`${summary.from}T00:00:00Z`),
          toDate: new Date(`${summary.to}T00:00:00Z`),
          createdById: actor.userId,
          createdByName: actor.name,
        },
      });
      await tx.attendancePunch.createMany({ data: toSave.map((p) => ({ boardId: actor.boardId, employeeId: p.employeeId, at: p.at, importId: record.id })), skipDuplicates: true });
      await audit(tx, actor, {
        action: "IMPORT",
        entityType: "AttendanceImport",
        entityId: record.id,
        summary: `Imported ${toSave.length} punches for ${summary.people} people (${formatDate(summary.from)} – ${formatDate(summary.to)}) from ${fileName}`,
        newValue: { format, sha256: stored.sha256, skipped: { alreadySaved: summary.alreadySaved, unknown: summary.unknownIds.length, locked: summary.locked, future: summary.future, errors: parsed.errors.length } },
      });
      await emit(tx, actor.boardId, "attendance.punches_imported", { type: "AttendanceImport", id: record.id }, { saved: toSave.length, from: summary.from, to: summary.to });
      return { ...summary, importId: record.id };
    },
    { timeout: 60_000 },
  );
}

export async function recentImports(actor: Actor) {
  if (!canEnterMuster(actor)) throw forbidden();
  return db.attendanceImport.findMany({ where: { boardId: actor.boardId }, orderBy: { createdAt: "desc" }, take: 20 });
}

/**
 * Device sync (AT-01): eSSL and ZKTeco devices in "ADMS / push" mode send attendance lines to
 * /iclock/cdata. Only devices whose serial number is listed in Settings are accepted.
 */
export async function devicePush(boardId: string, serial: string, body: string, ip: string | null) {
  const settings = await getSetting(boardId, "attendance");
  const device = settings.devices.find((d) => d.serial === serial);
  if (!device) return { accepted: false as const, saved: 0, received: 0 };
  const parsed = parseAttlog(body);
  if (parsed.punches.length === 0) return { accepted: true as const, saved: 0, received: 0 };
  return db.$transaction(async (tx) => {
    const { summary, toSave } = await classify(boardId, parsed.punches, tx);
    if (toSave.length) {
      await tx.attendancePunch.createMany({ data: toSave.map((p) => ({ boardId, employeeId: p.employeeId, at: p.at, deviceSerial: serial })), skipDuplicates: true });
      const who: AuditWho = { boardId, name: `Device ${device.name || serial}`, ip };
      await audit(tx, who, {
        action: "IMPORT",
        entityType: "AttendanceDevice",
        entityId: serial,
        summary: `Device ${device.name || serial} sent ${parsed.punches.length} punches; ${toSave.length} new`,
        newValue: { unknownIds: summary.unknownIds.map((u) => u.id), locked: summary.locked },
      });
    }
    return { accepted: true as const, saved: toSave.length, received: parsed.punches.length };
  });
}
