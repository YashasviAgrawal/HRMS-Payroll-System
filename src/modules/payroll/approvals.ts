import "server-only";
import type { z } from "zod";
import { chainTask } from "@/lib/approvals/engine";
import { defineApprovalKind } from "@/lib/approvals/registry";
import type { ISODate } from "@/lib/dates";
// Registers the bank-file release hooks (salary paid, failed credits re-paid).
import "./pay";
import { applyFixation, type FixationPayload } from "./fixation";
import { applyIncrements, type IncrementPayload } from "./increments";
import { onLoanApproved, onLoanRejected } from "./loans";
import { applyHead, applyMatrix, applyPayItem, applyRate, type headProposalSchema, type payItemSchema, type rateProposalSchema } from "./rates";
import { onApproved, onChecked, onSentBack } from "./run";
import { onSettlementApproved, onSettlementSentBack } from "./settlement";

/** PR-01/PR-02, S-81: rates, pay heads and pay matrices change only when an Admin approves. */
defineApprovalKind<z.infer<typeof rateProposalSchema>>({
  kind: "rate.change",
  requiredPermission: "APPROVER",
  async onApprove({ tx, payload, actor }) {
    await applyRate(tx, actor.boardId, actor, payload);
  },
});

defineApprovalKind<z.infer<typeof headProposalSchema>>({
  kind: "payhead.change",
  requiredPermission: "APPROVER",
  async onApprove({ tx, payload, actor }) {
    await applyHead(tx, actor.boardId, payload);
  },
});

defineApprovalKind<{ name: string; effectiveFrom: ISODate; levels: Record<string, number[]> }>({
  kind: "matrix.add",
  requiredPermission: "APPROVER",
  async onApprove({ tx, payload, actor }) {
    await applyMatrix(tx, actor.boardId, actor, payload);
  },
});

/** A standing allowance or deduction for one person changes pay, so a Checker checks it. */
defineApprovalKind<z.infer<typeof payItemSchema>>({
  kind: "payitem.change",
  requiredPermission: "CHECKER",
  sensitive: true,
  async onApprove({ tx, payload, actor, task }) {
    await applyPayItem(tx, actor.boardId, task.makerId, payload);
  },
});

/** S-40 stage 3: the Checker forwards the payroll to the Admin, or returns it. */
defineApprovalKind<{ runId: string }>({
  kind: "payroll.check",
  requiredPermission: "CHECKER",
  sensitive: true,
  async onApprove({ tx, task, payload, actor }) {
    await onChecked(tx, task, actor, payload.runId);
  },
  async onReject({ tx, payload }) {
    await onSentBack(tx, payload.runId);
  },
  async onCancel({ tx, payload }) {
    await onSentBack(tx, payload.runId);
  },
});

/** S-40 stage 4: an Admin (Approver + Pay bill signer) approves with an OTP, or returns it. */
defineApprovalKind<{ runId: string }>({
  kind: "payroll.approve",
  requiredPermission: "PAY_BILL_SIGNER",
  sensitive: true,
  async onApprove({ tx, payload, actor }) {
    await onApproved(tx, actor, payload.runId);
  },
  async onReject({ tx, payload }) {
    await onSentBack(tx, payload.runId);
  },
});

/** PR-06: HR confirms the increment list, a Checker verifies it. */
defineApprovalKind<IncrementPayload>({
  kind: "increment.batch",
  requiredPermission: "CHECKER",
  sensitive: true,
  async onApprove({ tx, task, payload, actor }) {
    await applyIncrements(tx, task, actor, payload);
  },
});

/** PR-07: a Checker checks the fixation, then an Admin approves it (promotion is an Approver event in the service book, §14). */
defineApprovalKind<FixationPayload & { step?: "approver" }>({
  kind: "pay.fixation",
  requiredPermission: "CHECKER",
  sensitive: true,
  async onApprove({ tx, task, payload, actor }) {
    if (payload.step !== "approver") {
      await chainTask(tx, task, { requiredPermission: "APPROVER", payload: { ...payload, step: "approver" } });
      return;
    }
    await applyFixation(tx, task, actor, payload);
  },
});

/** PR-09: Payroll sanctions, a Checker checks, an Admin approves (§14 arrears and loans). */
defineApprovalKind<{ loanId: string; step?: "approver" }>({
  kind: "loan.sanction",
  requiredPermission: "CHECKER",
  sensitive: true,
  async onApprove({ tx, task, payload }) {
    if (payload.step !== "approver") {
      await chainTask(tx, task, { requiredPermission: "APPROVER", payload: { ...payload, step: "approver" } });
      return;
    }
    await onLoanApproved(tx, task, payload.loanId);
  },
  async onReject({ tx, payload }) {
    await onLoanRejected(tx, payload.loanId);
  },
  async onCancel({ tx, payload }) {
    await onLoanRejected(tx, payload.loanId);
  },
});


/** Client add-on: the full and final settlement statement — a Checker checks, an Admin approves (§14 arrears and loans). */
defineApprovalKind<{ separationId: string; step?: "approver" }>({
  kind: "separation.settlement",
  requiredPermission: "CHECKER",
  sensitive: true,
  async onApprove({ tx, task, payload, actor }) {
    if (payload.step !== "approver") {
      await chainTask(tx, task, { requiredPermission: "APPROVER", payload: { ...payload, step: "approver" } });
      return;
    }
    await onSettlementApproved(tx, task, actor, payload.separationId);
  },
  async onReject({ tx, payload }) {
    await onSettlementSentBack(tx, payload.separationId);
  },
  async onReturn({ tx, payload }) {
    await onSettlementSentBack(tx, payload.separationId);
  },
  async onCancel({ tx, payload }) {
    await onSettlementSentBack(tx, payload.separationId);
  },
});
