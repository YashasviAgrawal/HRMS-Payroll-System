import { beforeAll, describe, expect, it } from "vitest";
import { decide } from "@/lib/approvals/engine";
import { db } from "@/lib/db";
import { downloadFile } from "@/lib/files";
import { verhoeffCheckDigit } from "@/lib/validators";
import { proposeEdit } from "@/modules/employees/service";
import { generatePranFile } from "@/modules/recruitment/files";
import {
  addApplicant,
  availableSeats,
  completeJoining,
  createVacancy,
  issueAppointmentLetter,
  markAdvertised,
  startDirectJoining,
  startJoining,
  submitSelection,
  updateApplicant,
  updateChecklist,
} from "@/modules/recruitment/service";
import { CHECKLIST_ITEMS } from "@/modules/recruitment/schema";
import { actorFor, hasTestDb, makeBoard, makeEmployee, makePost, makeSection, makeUser } from "../support/factory";

let k = 0;
const aadhaar = () => {
  const base = `6${String(5000000000 + ++k * 9931).padStart(10, "0")}`;
  return base + verhoeffCheckDigit(base);
};

describe.skipIf(!hasTestDb)("recruitment and onboarding (RO-01…RO-09)", () => {
  let boardId: string;
  let sectionId: string;
  let postId: string;
  let hr: Awaited<ReturnType<typeof actorFor>>;
  let checker: Awaited<ReturnType<typeof actorFor>>;
  let approver: Awaited<ReturnType<typeof actorFor>>;

  beforeAll(async () => {
    boardId = (await makeBoard()).id;
    sectionId = (await makeSection(boardId)).id;
    postId = (await makePost(boardId, "4")).id;
    await makeEmployee(boardId, { sectionId, postId });
    await db.sanctionedPost.create({ data: { boardId, sectionId, postId, sanctioned: 3 } });
    hr = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["HR"])).id);
    checker = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["CHECKER"])).id);
    approver = await actorFor((await makeUser(boardId, "ADMIN", ["APPROVER"])).id);
  });

  const approve = async (entityId: string, who: typeof hr) => {
    const t = await db.approvalTask.findFirstOrThrow({ where: { entityId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
    return decide(who, t.id, "APPROVE");
  };

  it("runs the whole PRD flow: vacancy → applicants → selection → letter → joining → Employee ID → login", async () => {
    // RO-01: only vacant sanctioned posts (3 sanctioned − 1 filled = 2).
    expect(await availableSeats(boardId, sectionId, postId)).toBe(2);
    await expect(createVacancy(hr, { sectionId, postId, seats: 3, reservation: { GEN: 3, OBC: 0, SC: 0, ST: 0, EWS: 0 } })).rejects.toMatchObject({ key: "recruitment.errors.noVacantPost" });
    await expect(createVacancy(hr, { sectionId, postId, seats: 2, reservation: { GEN: 1, OBC: 0, SC: 0, ST: 0, EWS: 0 } })).rejects.toThrow();
    const v = await createVacancy(hr, { sectionId, postId, seats: 2, reservation: { GEN: 1, OBC: 1, SC: 0, ST: 0, EWS: 0 } });
    expect(v.status).toBe("PENDING_APPROVAL");
    expect(await availableSeats(boardId, sectionId, postId)).toBe(0);

    // Applicants cannot be added before the Admin approves.
    await expect(addApplicant(hr, v.id, { name: "Early Bird", gender: "M", dateOfBirth: "1998-01-01", category: "GEN" })).rejects.toMatchObject({ key: "recruitment.errors.notAdvertised" });
    await approve(v.id, approver);
    await markAdvertised(hr, v.id, { advertNumber: "DCB/ADV/1/2026", advertDate: "2026-09-01", lastDate: "2026-09-30" });

    // RO-03 applicants and statuses.
    const a1 = await addApplicant(hr, v.id, { name: "Seema Yadav", gender: "F", dateOfBirth: "1998-04-10", category: "OBC", mobile: "9877700001", fatherName: "Ram Yadav" });
    const a2 = await addApplicant(hr, v.id, { name: "Rohit Jain", gender: "M", dateOfBirth: "1997-02-11", category: "GEN" });
    const a3 = await addApplicant(hr, v.id, { name: "Amit Kumar", gender: "M", dateOfBirth: "1996-06-01", category: "GEN" });
    expect(a1.applicationNo).toBe("A-0001");
    await updateApplicant(hr, a1.id, { status: "SELECTED", score: 88, meritRank: 1 });
    await updateApplicant(hr, a2.id, { status: "SELECTED", score: 80, meritRank: 2 });
    await updateApplicant(hr, a3.id, { status: "SELECTED", score: 79, meritRank: 3 });
    // Three selected for two seats → refused.
    await expect(submitSelection(hr, v.id)).rejects.toMatchObject({ key: "recruitment.errors.tooManySelected" });
    // Two GEN candidates for the single unreserved seat → refused (the OBC seat is reserved).
    await updateApplicant(hr, a1.id, { status: "WAITLISTED", score: 88, meritRank: 1 });
    await expect(submitSelection(hr, v.id)).rejects.toMatchObject({ key: "recruitment.errors.genOverReserved" });
    await updateApplicant(hr, a1.id, { status: "SELECTED", score: 88, meritRank: 1 });
    await updateApplicant(hr, a3.id, { status: "WAITLISTED", score: 79, meritRank: 3 });
    await submitSelection(hr, v.id);
    await expect(updateApplicant(hr, a3.id, { status: "SELECTED" })).rejects.toMatchObject({ key: "recruitment.errors.selectionLocked" });
    await approve(v.id, approver);

    // RO-04 appointment letter, RO-05/06 joining.
    await expect(startJoining(hr, a1.id)).rejects.toMatchObject({ key: "recruitment.errors.letterFirst" });
    const letter = await issueAppointmentLetter(hr, a1.id);
    expect(letter.appointmentLetterNo).toMatch(/^DCB\/REC\/\d{4}\/\d{3}\/APT\/01$/);
    const j = await startJoining(hr, a1.id, "2026-10-12");
    const draft = await db.employee.findUniqueOrThrow({ where: { id: j.employeeId } });
    expect(draft).toMatchObject({ status: "DRAFT", payLevel: "4", payCell: 1, type: "PERMANENT_NPS" });
    expect(draft.probationEndDate?.toISOString().slice(0, 10)).toBe("2028-10-11");

    await expect(completeJoining(hr, j.id)).rejects.toMatchObject({ key: "recruitment.errors.checklistIncomplete" });
    for (const item of CHECKLIST_ITEMS) await updateChecklist(hr, j.id, { item, done: true });
    await expect(completeJoining(hr, j.id)).rejects.toMatchObject({ key: "recruitment.errors.idsMissing" });
    // HR fills identity and bank on the draft record (applies directly while it is a draft).
    await proposeEdit(hr, draft.id, "ids", { pan: "ABHPY1234K", aadhaar: aadhaar(), bankAccount: "33445566778", ifsc: "SBIN0001234" });
    await completeJoining(hr, j.id);
    await approve(draft.id, checker);

    const joined = await db.employee.findUniqueOrThrow({ where: { id: draft.id } });
    expect(joined.status).toBe("ACTIVE");
    expect(joined.employeeCode).toMatch(/^DCB\d{5}$/);
    expect(await db.serviceBookEntry.count({ where: { employeeId: draft.id, event: "APPOINTMENT", status: "APPROVED" } })).toBe(1);
    const login = await db.user.findFirstOrThrow({ where: { employeeId: draft.id, loginType: "EMPLOYEE" } });
    expect(login.mobile).toBe("9877700001");
    expect((await db.joining.findUniqueOrThrow({ where: { id: j.id } })).status).toBe("COMPLETED");
  });

  it("onboards a contract worker directly, without a vacancy (RO-09)", async () => {
    const j = await startDirectJoining(hr, {
      firstName: "Lakhan",
      lastName: "Singh",
      gender: "M",
      dateOfBirth: "1995-05-05",
      type: "CONTRACT",
      sectionId,
      postId,
      dateOfJoining: "2026-10-01",
      agencyName: "Shiv Shakti Manpower",
      wageRate: 21917,
      wageBasis: "MONTHLY",
      contractStart: "2026-10-01",
      contractEnd: "2027-09-30",
    });
    const e = await db.employee.findUniqueOrThrow({ where: { id: j.employeeId } });
    expect(e).toMatchObject({ status: "DRAFT", type: "CONTRACT", payLevel: null, dateOfRetirement: null });
    expect(Number(e.wageRate)).toBe(21917);
  });

  it("generated files need an Admin's approval before download, and the checksum is logged (RO-07, ST-09)", async () => {
    const npsJoiner = await makeEmployee(boardId, { sectionId, postId });
    expect(npsJoiner.pran).toBeNull();
    const payroll = await actorFor((await makeUser(boardId, "HR_ACCOUNTS", ["PAYROLL", "HR"])).id);
    const file = await generatePranFile(payroll);
    expect(file.status).toBe("PREVIEW");
    await expect(downloadFile(payroll, file.id)).rejects.toMatchObject({ key: "files.notApproved" });
    await expect(approve(file.id, payroll)).rejects.toMatchObject({ status: 403 });
    await approve(file.id, approver);
    const { buffer, file: f } = await downloadFile(payroll, file.id);
    expect(buffer.toString("utf8")).toContain("Employee ID");
    expect(f.sha256).toHaveLength(64);
    expect(await db.auditLog.count({ where: { entityId: file.id, action: "DOWNLOAD" } })).toBe(1);
  });
});
