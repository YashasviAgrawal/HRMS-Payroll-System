import "server-only";
import { canAll } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { decrypt } from "@/lib/crypto";
import { portalDate, toCsv } from "@/lib/csv";
import { db } from "@/lib/db";
import { todayIST, toISODate } from "@/lib/dates";
import { badRequest, forbidden } from "@/lib/errors";
import { createOutgoingFile } from "@/lib/files";
import { mimeOf } from "@/lib/storage";
import { matrixToday } from "@/modules/payroll/compute";
import { basicIn } from "@/modules/payroll/matrix-7cpc";

/**
 * RO-07: registration data for new joiners — NPS (PRAN) for permanent-NPS staff, EPF (UAN) and ESIC for
 * contract and daily-wage workers. Each file goes through preview → Admin approval → download (ST-09).
 * Column layouts follow the CRA / EPFO / ESIC bulk templates and must be confirmed with a real upload
 * before go-live (PRD §18).
 */
function assertAllowed(actor: Actor) {
  if (!canAll(actor, "recruitment", "create") && !canAll(actor, "statutory", "create")) throw forbidden();
}

export async function generatePranFile(actor: Actor) {
  assertAllowed(actor);
  const rows = await db.employee.findMany({
    where: { boardId: actor.boardId, type: "PERMANENT_NPS", status: "ACTIVE", pran: null },
    include: { post: true },
    orderBy: { employeeCode: "asc" },
  });
  if (!rows.length) throw badRequest("recruitment.errors.nobodyToRegister");
  const matrix = await matrixToday(actor.boardId, db);
  const columns = ["Employee ID", "Title", "First name", "Middle name", "Last name", "Father's name", "Date of birth", "Gender", "PAN", "Mobile", "Email", "Date of joining", "Basic pay", "Bank account", "IFSC", "Designation"];
  const data = rows.map((e) => [
    e.employeeCode,
    e.gender === "F" ? "Smt" : "Shri",
    e.firstName,
    e.middleName,
    e.lastName,
    e.fatherOrSpouseName,
    portalDate(toISODate(e.dateOfBirth)),
    e.gender,
    e.panEnc ? decrypt(e.panEnc) : "",
    e.mobile,
    e.email,
    portalDate(toISODate(e.dateOfJoining)),
    basicIn(matrix, e.payLevel, e.payCell) ?? "",
    e.bankAccountEnc ? decrypt(e.bankAccountEnc) : "",
    e.ifsc,
    e.post.name,
  ]);
  const buffer = Buffer.from(toCsv(columns, data), "utf8");
  const stamp = todayIST();
  return createOutgoingFile(actor, {
    kind: "PRAN_REGISTRATION",
    period: stamp.slice(0, 7),
    fileName: `DCB-PRAN-registration-${stamp}.csv`,
    ext: "csv",
    mimeType: mimeOf("csv"),
    buffer,
    title: `PRAN registration file: ${rows.length} NPS joiners`,
    titleHi: `प्रान पंजीकरण फ़ाइल: ${rows.length} एनपीएस कर्मचारी`,
    link: "/recruitment?tab=files",
    // The preview never shows PAN or bank numbers in full.
    preview: {
      columns: ["Employee ID", "Name", "Date of birth", "Date of joining", "PAN", "Basic pay"],
      rows: rows.slice(0, 20).map((e) => [e.employeeCode ?? "", [e.firstName, e.lastName].filter(Boolean).join(" "), portalDate(toISODate(e.dateOfBirth)), portalDate(toISODate(e.dateOfJoining)), e.panLast4 ? `XXXXXX${e.panLast4}` : "—", basicIn(matrix, e.payLevel, e.payCell) ?? ""]),
      totalRows: rows.length,
    },
  });
}

export async function generateEpfEsicFile(actor: Actor) {
  assertAllowed(actor);
  const rows = await db.employee.findMany({
    where: { boardId: actor.boardId, type: { in: ["CONTRACT", "DAILY_WAGE"] }, status: "ACTIVE", OR: [{ uan: null }, { esicNumber: null }] },
    orderBy: { employeeCode: "asc" },
  });
  if (!rows.length) throw badRequest("recruitment.errors.nobodyToRegister");
  // EPFO member registration: one line per member, fields separated by #~# (unified portal bulk format).
  const monthlyWage = (e: (typeof rows)[number]) => (e.wageBasis === "DAILY" ? Number(e.wageRate ?? 0) * 26 : Number(e.wageRate ?? 0));
  const epfLines = rows.map((e) =>
    [
      "", // UAN (blank for new)
      e.employeeCode,
      [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" ").toUpperCase(),
      portalDate(toISODate(e.dateOfBirth)),
      portalDate(toISODate(e.dateOfJoining)),
      e.gender,
      (e.fatherOrSpouseName ?? "").toUpperCase(),
      e.maritalStatus === "MARRIED" && e.gender === "F" ? "H" : "F",
      e.mobile ?? "",
      e.email ?? "",
      "INDIAN",
      Math.round(monthlyWage(e)),
      e.maritalStatus === "MARRIED" ? "M" : "U",
    ].join("#~#"),
  );
  const buffer = Buffer.from(epfLines.join("\r\n") + "\r\n", "utf8");
  const stamp = todayIST();
  return createOutgoingFile(actor, {
    kind: "EPF_ESIC_REGISTRATION",
    period: stamp.slice(0, 7),
    fileName: `DCB-EPF-member-registration-${stamp}.txt`,
    ext: "txt",
    mimeType: mimeOf("txt"),
    buffer,
    title: `EPF / ESIC registration file: ${rows.length} contract workers`,
    titleHi: `ईपीएफ़ / ईएसआईसी पंजीकरण फ़ाइल: ${rows.length} अनुबंध कर्मी`,
    link: "/recruitment?tab=files",
    preview: {
      columns: ["Employee ID", "Name", "Date of joining", "Monthly wage", "UAN", "ESIC"],
      rows: rows.slice(0, 20).map((e) => [e.employeeCode ?? "", [e.firstName, e.lastName].filter(Boolean).join(" "), portalDate(toISODate(e.dateOfJoining)), Math.round(monthlyWage(e)), e.uan ?? "new", e.esicNumber ?? "new"]),
      totalRows: rows.length,
    },
  });
}
