import "server-only";
import type { DayStatus } from "@/generated/prisma/client";
import { defineApprovalKind } from "@/lib/approvals/registry";
import { audit } from "@/lib/audit";
import type { ISODate } from "@/lib/dates";
import { emit } from "@/lib/outbox";
import { applyHolidayList, type HolidayInput } from "./holidays";
import { applyAttendanceRequest, applyMuster } from "./service";

/** AT-04: the reporting officer (or HR, for officers' own requests) decides a missed-punch / on-duty request. */
defineApprovalKind<{ requestId: string }>({
  kind: "attendance.request",
  requiredPermission: "REPORTING_OFFICER",
  allowSelfSubject: true,
  async onApprove({ tx, payload, actor }) {
    await applyAttendanceRequest(tx, actor, payload.requestId);
  },
  async onReject({ tx, payload }) {
    await tx.attendanceRequest.update({ where: { id: payload.requestId }, data: { status: "REJECTED", decidedAt: new Date() } });
  },
  async onReturn({ tx, payload }) {
    await tx.attendanceRequest.update({ where: { id: payload.requestId }, data: { status: "RETURNED", decidedAt: new Date() } });
  },
  async onCancel({ tx, payload }) {
    await tx.attendanceRequest.update({ where: { id: payload.requestId }, data: { status: "CANCELLED", decidedAt: new Date() } });
  },
});

/** AT-02: a Checker checks muster entries and HR corrections before they count. */
defineApprovalKind<{ sectionId: string; month: string; entries: { employeeId: string; date: ISODate; status: DayStatus | null }[] }>({
  kind: "attendance.muster",
  requiredPermission: "CHECKER",
  async onApprove({ tx, payload, actor, task }) {
    await applyMuster(tx, actor, payload, task.makerId);
  },
});

/** Reopening a locked month (HR asks, a Checker decides). */
defineApprovalKind<{ lockId: string }>({
  kind: "attendance.unlock",
  requiredPermission: "CHECKER",
  async onApprove({ tx, payload, actor, task }) {
    const lock = await tx.attendanceLock.update({ where: { id: payload.lockId }, data: { unlockedAt: new Date(), unlockNote: task.makerNote } });
    // Month totals are worked out again at the next lock.
    const staff = await tx.attendanceMonth.findMany({ where: { boardId: lock.boardId, sectionId: lock.sectionId, month: lock.month }, select: { id: true } });
    await tx.attendanceMonth.deleteMany({ where: { id: { in: staff.map((s) => s.id) } } });
    await audit(tx, actor, { action: "UNLOCK", entityType: "AttendanceLock", entityId: lock.id, summary: `Reopened attendance for ${lock.month}` });
    await emit(tx, lock.boardId, "attendance.month_unlocked", { type: "AttendanceLock", id: lock.id }, { sectionId: lock.sectionId, month: lock.month });
  },
});

/** AT-08: the year's holiday list, checked before it changes anyone's attendance. */
defineApprovalKind<{ year: number; holidays: HolidayInput[] }>({
  kind: "holiday.calendar",
  requiredPermission: "CHECKER",
  async onApprove({ tx, payload, actor }) {
    await applyHolidayList(tx, actor.boardId, payload);
  },
});
