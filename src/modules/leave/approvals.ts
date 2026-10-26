import "server-only";
import { defineApprovalKind } from "@/lib/approvals/registry";
import type { ISODate } from "@/lib/dates";
import type { leaveRuleSchema } from "./schema";
import { applyLeaveRule, applyOpening, approveLeave, closeLeave } from "./service";

const decisions = {
  async onApprove({ tx, payload, actor }: { tx: Parameters<typeof approveLeave>[0]; payload: { applicationId: string }; actor: Parameters<typeof approveLeave>[1] }) {
    await approveLeave(tx, actor, payload.applicationId);
  },
  async onReject({ tx, payload }: { tx: Parameters<typeof closeLeave>[0]; payload: { applicationId: string } }) {
    await closeLeave(tx, payload.applicationId, "REJECTED");
  },
  async onReturn({ tx, payload }: { tx: Parameters<typeof closeLeave>[0]; payload: { applicationId: string } }) {
    await closeLeave(tx, payload.applicationId, "RETURNED");
  },
  async onCancel({ tx, payload }: { tx: Parameters<typeof closeLeave>[0]; payload: { applicationId: string } }) {
    await closeLeave(tx, payload.applicationId, "CANCELLED");
  },
};

/** LV-03: the reporting officer within their limit, an Admin beyond it (PRD §7 flow, §14 "A beyond officer's limit"). */
defineApprovalKind<{ applicationId: string }>({ kind: "leave.apply", requiredPermission: "REPORTING_OFFICER", allowSelfSubject: true, ...decisions });

/** LV-05: leave HR entered from a paper sanction, decided like an application (officer or Admin). */
defineApprovalKind<{ applicationId: string }>({ kind: "leave.entry", requiredPermission: "REPORTING_OFFICER", ...decisions });

/** LV-01: the leave rules table changes only with an Admin's approval. */
defineApprovalKind<ReturnType<typeof leaveRuleSchema.parse> & { isNew: boolean }>({
  kind: "leave.rule",
  requiredPermission: "APPROVER",
  async onApprove({ tx, payload, actor }) {
    await applyLeaveRule(tx, actor.boardId, payload);
  },
});

/** LV-06: opening balances, checked by a Checker. */
defineApprovalKind<{ asOn: ISODate; rows: { employeeId: string; leaveCode: string; days: number }[] }>({
  kind: "leave.opening",
  requiredPermission: "CHECKER",
  async onApprove({ tx, payload, actor, task }) {
    await applyOpening(tx, actor.boardId, payload, task.makerId);
  },
});
